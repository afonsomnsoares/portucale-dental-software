import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne, withTransaction } from '@/lib/db';
import { createTask } from '@/lib/patientTasks';
import { hasPermission } from '@/lib/permissions';
import { notifyWaitlistOfFreedSlot } from '@/lib/waitlist';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'appointments:status'))) return forbidden();
  const { id } = await params;
  const { status }: { status: string } = await request.json();
  const tenantId = user.role === 'super_admin' ? null : user.tenantId;

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM appointments WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid) FOR UPDATE`,
      [id, tenantId],
    );
    const apt = rows[0];
    if (!apt) return { error: 'Not found', status: 404 };

    const { rows: statusRows } = await client.query(`SELECT transitions FROM statuses WHERE key=$1`, [apt.status]);
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

    return { apt, updated };
  });

  if (result.error) return Response.json({ error: result.error }, { status: result.status });

  const msgs: Record<string, string> = {
    waiting: 'Check-in feito — estado: À espera',
    'in-operatory': 'Registo aberto — Em atendimento',
    'procedure-active': 'Procedimento ativo no odontograma',
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
        });
      }
    }
  }

  return Response.json(result.updated);
}
