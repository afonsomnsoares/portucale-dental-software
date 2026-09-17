import { appendAudit, appendTimeline } from '@/lib/audit';
import { query, queryOne, withTransaction } from '@/lib/db';
import { conflict } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { claimSlot, SlotTakenError } from '@/lib/scheduling';
import { getOwnedUser } from '@/lib/tenantGuard';
import { notifyWaitlistOfFreedSlot } from '@/lib/waitlist';

export const PUT = withRoute<{ id: string }>(
  { permission: 'appointments:update', tenant: 'required' },
  async ({ request, user, params, tenantId }) => {
    const { id } = params;

    const body = await request.json();
    const prev = await queryOne(`SELECT * FROM appointments WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

    const dentistId = body.dentistId ?? body.dentist_id ?? prev.dentist_id;
    if (dentistId) {
      const d = await getOwnedUser(dentistId, { tenantId }, { role: 'dentist', activeOnly: true });
      if (!d) return Response.json({ error: 'Invalid dentist' }, { status: 400 });
    }

    const chair = Math.max(1, Number((body.chair ?? prev.chair) || 1));
    const duration = Math.max(5, Number((body.duration ?? prev.duration) || 30));
    const apptDate = body.date ?? body.appt_date ?? prev.appt_date;
    const startTime = body.startTime ?? body.start_time ?? prev.start_time;

    // Mudou de lugar na agenda, ou só de notas/tipo? A distinção decide duas coisas: se
    // é preciso verificar sobreposição, e se o doente tem de ser avisado. Comparar em
    // texto porque `prev` vem do Postgres como Date/string conforme a coluna.
    const iso = (v: unknown) => String(v ?? '').slice(0, 10);
    const hhmm = (v: unknown) => String(v ?? '').slice(0, 5);
    const moveu =
      iso(apptDate) !== iso(prev.appt_date) ||
      hhmm(startTime) !== hhmm(prev.start_time) ||
      Number(duration) !== Number(prev.duration) ||
      Number(chair) !== Number(prev.chair) ||
      String(dentistId ?? '') !== String(prev.dentist_id ?? '');

    let updated: Record<string, unknown>;
    try {
      updated = await withTransaction(async (client) => {
        // A verificação que faltava aqui. Sem ela, editar a data de uma consulta à mão
        // podia pô-la em cima de outra, na mesma cadeira ou com o mesmo dentista, sem
        // erro nenhum — e só se descobria com os dois doentes na sala de espera.
        if (moveu) {
          await claimSlot(client, {
            tenantId,
            dentistId,
            date: iso(apptDate),
            startTime: hhmm(startTime),
            duration,
            chair,
            excludeAppointmentId: id,
          });
        }

        const { rows } = await client.query(
          `UPDATE appointments
              SET dentist_id=$1, chair=$2, appt_date=$3, start_time=$4, duration=$5, type=$6, notes=$7,
                  -- Só quando muda mesmo de lugar: é o que faz a tarefa 'confirmations'
                  -- avisar o doente da data nova (ver a migração 061). Carimbar em cada
                  -- gravação mandaria uma mensagem por cada correção de uma nota.
                  rescheduled_at = CASE WHEN $10 THEN NOW() ELSE rescheduled_at END
            WHERE id=$8 AND tenant_id=$9
            RETURNING *`,
          [
            dentistId,
            chair,
            apptDate,
            startTime,
            duration,
            body.type ?? prev.type,
            body.notes ?? prev.notes,
            id,
            tenantId,
            moveu,
          ],
        );
        return rows[0];
      });
    } catch (e) {
      if (e instanceof SlotTakenError) {
        return conflict('Este horário já está ocupado — escolha outro.');
      }
      throw e;
    }

    const full = await queryOne(
      `SELECT a.*, p.name as patient_name, d.name as dentist_name,
            ROUND((p.no_show_count::numeric / NULLIF(p.visit_count,0)) * 100) as risk_score
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     LEFT JOIN users d ON d.id = a.dentist_id
     WHERE a.id=$1`,
      [updated.id],
    );

    await appendAudit(user, 'UPDATE', `Appointment — edit`, null, String(updated.id).slice(0, 8), user.clinic);
    if (updated.patient_id) {
      await appendTimeline(
        String(updated.patient_id),
        user,
        'admin',
        // Diz-se o que aconteceu: mudar de lugar na agenda e corrigir uma nota são
        // factos diferentes na história do doente, e a timeline é imutável.
        moveu
          ? `Consulta remarcada: ${iso(prev.appt_date)} ${hhmm(prev.start_time)} → ${iso(updated.appt_date)} ${hhmm(updated.start_time)}`
          : `Consulta atualizada: ${iso(updated.appt_date)} ${hhmm(updated.start_time)} · ${updated.type}`,
      );
    }

    return Response.json(full || updated);
  },
);

export const DELETE = withRoute<{ id: string }>(
  { permission: 'appointments:cancel', tenant: 'required' },
  async ({ user, params, tenantId }) => {
    const { id } = params;
    const prev = await queryOne(`SELECT * FROM appointments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
      id,
      tenantId,
    ]);
    if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

    // Cancellations hard-delete the appointment row, so log the freed slot first — this is
    // what backs the Revenue Recovery "cancelled" category and triggers waitlist matching.
    const [cancellation] = await query(
      `INSERT INTO appointment_cancellations
       (tenant_id, appointment_id, patient_id, patient_name, dentist_id, chair, appt_date, start_time, duration, type, cancelled_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
      [
        prev.tenant_id,
        prev.id,
        prev.patient_id,
        prev.patient_name,
        prev.dentist_id,
        prev.chair,
        prev.appt_date,
        prev.start_time,
        prev.duration,
        prev.type,
        user.id,
      ],
    );

    await query(`DELETE FROM appointments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [id, tenantId]);
    await appendAudit(
      user,
      'DELETE',
      `Appointment: ${prev.patient_name || prev.patient_id} — ${prev.type}`,
      prev.status,
      null,
      user.clinic,
    );
    if (prev.patient_id) {
      await appendTimeline(
        prev.patient_id,
        user,
        'admin',
        `Appointment removed: ${prev.type} on ${String(prev.appt_date).slice(0, 10)} at ${String(prev.start_time).slice(0, 5)}`,
      );
    }

    // Only worth offering to the waitlist if the slot was still in the future.
    const isFuture = String(prev.appt_date).slice(0, 10) >= new Date().toISOString().slice(0, 10);
    if (isFuture && prev.tenant_id) {
      await notifyWaitlistOfFreedSlot(
        prev.tenant_id,
        {
          date: String(prev.appt_date).slice(0, 10),
          startTime: String(prev.start_time).slice(0, 5),
          type: String(prev.type || ''),
          duration: Number(prev.duration),
          dentistId: prev.dentist_id || null,
          chair: Number(prev.chair) || 1,
        },
        cancellation?.id || null,
      ).catch((e) => {
        // Never fail the cancellation itself because waitlist matching had a problem.
        console.error('notifyWaitlistOfFreedSlot failed:', e instanceof Error ? e.message : e);
      });
    }

    return Response.json({ deleted: true });
  },
);
