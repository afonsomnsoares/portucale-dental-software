import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden } from '@/lib/auth';
import { formatEUR } from '@/lib/constants';
import { queryOne, withTransaction } from '@/lib/db';
import { badRequest } from '@/lib/http';
import { createTask } from '@/lib/patientTasks';
import { hasPermission } from '@/lib/permissions';
import { withRoute } from '@/lib/route';
import { asFee } from '@/lib/validate';
import { notifyWaitlistOfFreedSlot } from '@/lib/waitlist';

// O estado em que a consulta acaba e o doente sai. É aqui — e só aqui — que se lança o
// valor da consulta, porque é este o momento em que a receção o sabe.
const CLOSING_STATUS = 'departed';

export const PUT = withRoute<{ id: string }>(
  { permission: 'appointments:status', tenant: 'required' },
  async ({ request, user, params, tenantId }) => {
    const { id } = params;
    const body = await request.json();
    const status = String(body?.status || '');

    // Valor da consulta, opcional: nem toda a consulta cobra (seguimento incluído,
    // comparticipação, cortesia). Quando vem, tem de ser um número válido — um valor
    // que alguém escreveu e o sistema descartou em silêncio é pior do que um erro.
    const rawAmount = body?.amount;
    const hasAmount = rawAmount !== undefined && rawAmount !== null && String(rawAmount).trim() !== '';
    const amount = hasAmount ? asFee(rawAmount) : null;
    if (hasAmount) {
      if (amount === null || amount <= 0) return badRequest('O valor da consulta tem de ser um número maior que zero');
      if (status !== CLOSING_STATUS) return badRequest('O valor só pode ser lançado quando o doente sai da consulta');
      // Lançar um valor é criar um registo de conta corrente — quem fecha a consulta não
      // tem necessariamente essa permissão, e não é a de mudar estado que a concede.
      if (!(await hasPermission(user, 'invoices:create'))) return forbidden();
    }

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM appointments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid) FOR UPDATE`,
        [id, tenantId],
      );
      const apt = rows[0];
      if (!apt) return { error: 'Not found', status: 404 };

      // Workflow por clínica (migração 035): o override desta clínica ganha ao
      // estado global com a mesma chave.
      const { rows: statusRows } = await client.query(
        `SELECT transitions FROM statuses
        WHERE key=$1 AND (tenant_id IS NULL OR tenant_id = $2::uuid)
        ORDER BY (tenant_id IS NOT NULL) DESC LIMIT 1`,
        [apt.status, tenantId],
      );
      const allowed = statusRows[0]?.transitions || [];

      if (!allowed.includes(status)) return { error: `Cannot transition ${apt.status} → ${status}`, status: 400 };

      const { rows: updatedRows } = await client.query(`UPDATE appointments SET status=$1 WHERE id=$2 RETURNING *`, [
        status,
        id,
      ]);
      const updated = updatedRows[0];

      const ptStatusMap: Record<string, string> = {
        waiting: 'waiting',
        'in-operatory': 'in-operatory',
        'procedure-active': 'in-operatory',
        'ready-dismissal': 'ready-dismissal',
        departed: 'departed',
      };
      if (ptStatusMap[status]) {
        await client.query(`UPDATE patients SET status=$1 WHERE id=$2`, [ptStatusMap[status], apt.patient_id]);
      }
      if (status === 'departed') {
        await client.query(`UPDATE patients SET visit_count = visit_count + 1, last_visit = CURRENT_DATE WHERE id=$1`, [
          apt.patient_id,
        ]);
      } else if (status === 'no-show') {
        await client.query(`UPDATE patients SET no_show_count = no_show_count + 1 WHERE id=$1`, [apt.patient_id]);
      }

      // O valor entra na mesma transação que o fecho da consulta, de propósito: se a
      // criação do registo falhar, o estado não avança. A alternativa — duas chamadas —
      // deixa a receção a pensar que lançou um valor que se perdeu.
      let invoice = null;
      if (amount !== null && status === CLOSING_STATUS) {
        // Uma consulta gera um registo só. O índice único da migração 042 garante-o na
        // base de dados; esta verificação transforma a violação num erro legível.
        const { rows: existing } = await client.query(`SELECT id FROM invoices WHERE appointment_id=$1`, [id]);
        if (existing.length) return { error: 'Esta consulta já tem um valor lançado', status: 409 };

        const today = new Date().toLocaleDateString('en-CA');
        const { rows: invRows } = await client.query(
          `INSERT INTO invoices
           (tenant_id, patient_id, patient_name, dentist_id, appointment_id, amount, items, notes,
            invoice_date, due_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8::date,$8::date,'pending',$9)
         RETURNING *`,
          [
            apt.tenant_id,
            apt.patient_id,
            apt.patient_name,
            apt.dentist_id,
            id,
            amount,
            `Consulta de ${apt.type || 'clínica'} em ${String(apt.appt_date).slice(0, 10)}`,
            today,
            user.id || null,
          ],
        );
        invoice = invRows[0];
        await client.query(`UPDATE patients SET balance = balance + $1 WHERE id=$2`, [amount, apt.patient_id]);
      }

      return { apt, updated, invoice };
    });

    if (result.error) return Response.json({ error: result.error }, { status: result.status });

    const msgs: Record<string, string> = {
      waiting: 'Check-in feito — estado: À espera',
      'in-operatory': 'Registo aberto — Em atendimento',
      'procedure-active': 'Procedimento ativo',
      'ready-dismissal': 'Dentista terminou — Pronto para alta',
      departed: 'Paciente saiu',
      'no-show': 'Marcado como falta',
    };
    await appendTimeline(
      result.apt.patient_id,
      user,
      status === 'ready-dismissal' ? 'clinical' : 'admin',
      msgs[status] || `Status → ${status}`,
    );
    await appendAudit(user, 'UPDATE', `Appointment — status`, result.apt.status, status, user.clinic);

    if (result.invoice) {
      const valor = formatEUR(Number(result.invoice.amount));
      await appendTimeline(result.apt.patient_id, user, 'financial', `Valor da consulta lançado: ${valor}`);
      await appendAudit(user, 'CREATE', `Valor de consulta — ${valor}`, null, 'pending', user.clinic);
    }

    // Same-day walk-in fill: unlike a cancellation (DELETE, which always frees the slot —
    // see app/api/appointments/[id]/route.ts), a no-show only frees the chair for the
    // *rest of the day* it happened on, so only offer it when there's still time left in
    // that same day. Never for a no-show marked on a past date (backfilled data entry).
    const apt = result.apt;
    if (status === 'no-show' && apt.tenant_id) {
      const today = new Date().toISOString().slice(0, 10);
      if (String(apt.appt_date).slice(0, 10) === today) {
        await notifyWaitlistOfFreedSlot(
          apt.tenant_id,
          {
            date: String(apt.appt_date).slice(0, 10),
            startTime: String(apt.start_time).slice(0, 5),
            type: String(apt.type || ''),
            duration: Number(apt.duration),
            dentistId: apt.dentist_id || null,
            chair: Number(apt.chair) || 1,
          },
          null,
        ).catch((e) => {
          console.error('notifyWaitlistOfFreedSlot (no-show) failed:', e instanceof Error ? e.message : e);
        });
      }
    }

    // Item 10 — "tarefas pós-consulta"/"próxima marcação": when the patient leaves, check
    // whether they have accepted treatment work sitting idle with nothing booked to
    // continue it (same condition as lib/recovery.ts's "accepted_open" — treatments the
    // patient already said yes to, but nobody's chasing the next session for). If so, drop
    // a task in the team queue instead of relying on someone to notice on their own — the
    // dedupe check (an existing pending task with this same marker) keeps a patient who
    // departs from several appointments in a row from getting one task per visit.
    if (status === 'departed' && apt.tenant_id && apt.patient_id) {
      const openTreatment = await queryOne(
        `SELECT 1 FROM treatments t
       WHERE t.tenant_id=$1 AND t.patient_id=$2 AND t.status='accepted'
         AND NOT EXISTS (
           SELECT 1 FROM appointments a2
           WHERE a2.patient_id=t.patient_id AND a2.appt_date >= CURRENT_DATE AND a2.status <> 'no-show'
         )
       LIMIT 1`,
        [apt.tenant_id, apt.patient_id],
      );
      if (openTreatment) {
        const marker = `next-session:${apt.patient_id}`;
        const existing = await queryOne(
          `SELECT 1 FROM patient_tasks WHERE tenant_id=$1 AND notes=$2 AND status='pending' LIMIT 1`,
          [apt.tenant_id, marker],
        );
        if (!existing) {
          await createTask(apt.tenant_id, user.id || null, {
            patientId: apt.patient_id,
            type: 'follow_up',
            title: `Marcar próxima sessão — ${apt.patient_name || 'paciente'}`,
            notes: marker,
            // Item 11 — marcar a próxima sessão é trabalho de receção e nasce aqui
            // sem dono; o router escolhe quem está de turno com menos carga aberta.
            autoAssign: true,
          });
        }
      }
    }

    return Response.json({ ...result.updated, invoice: result.invoice ?? null });
  },
);
