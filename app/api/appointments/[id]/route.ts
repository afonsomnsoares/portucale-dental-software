import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne, withTransaction } from '@/lib/db';
import { conflict } from '@/lib/http';
import { hasPermission } from '@/lib/permissions';
import { getOwnedUser } from '@/lib/tenantGuard';
import { notifyWaitlistOfFreedSlot } from '@/lib/waitlist';

// Sinal interno da transação para o catch — nunca serializado. Igual ao de
// app/api/appointments/route.ts, e pela mesma razão: distinguir "horário
// ocupado" de qualquer outra falha sem comparar mensagens de erro.
class SlotTakenError extends Error {}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'appointments:update'))) return forbidden();

  const { id } = await params;
  const tenantId = user.role === 'super_admin' ? null : user.tenantId;
  if (!tenantId) return forbidden();

  const body = await request.json();
  const prev = await queryOne(`SELECT * FROM appointments WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
  if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

  const dentistId = body.dentistId ?? body.dentist_id ?? prev.dentist_id;
  if (dentistId) {
    const d = await getOwnedUser(dentistId, { tenantId }, { role: 'dentist', activeOnly: true });
    if (!d) return Response.json({ error: 'Invalid dentist' }, { status: 400 });
  }

  const chair = Math.max(1, Math.min(99, Number(body.chair ?? prev.chair) || 1));
  const duration = Math.max(5, Math.min(480, Number(body.duration ?? prev.duration) || 30));
  const apptDate = String(body.date ?? body.appt_date ?? prev.appt_date).slice(0, 10);
  const startTime = String(body.startTime ?? body.start_time ?? prev.start_time).slice(0, 5);

  // Remarcar é marcar. Esta verificação existia só no POST — o que significava
  // que a porta da frente estava fechada e a das traseiras aberta: bastava criar
  // a consulta num horário livre e arrastá-la para cima de outra. Não dava erro
  // nenhum, e o choque só aparecia com os dois doentes na sala de espera.
  //
  // Mesmo advisory lock do POST (tenant|dentista|dia) para dois pedidos
  // simultâneos não passarem os dois na verificação, e a exclusão da própria
  // linha para uma consulta não colidir consigo mesma ao mudar, por exemplo, só
  // as notas.
  let updated: Record<string, unknown>;
  try {
    updated = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${tenantId}|${dentistId || 'sem-dentista'}|${apptDate}`,
      ]);

      const { rows: clashes } = await client.query(
        `SELECT id FROM appointments
          WHERE tenant_id=$1 AND appt_date=$2::date AND id <> $7
            AND (($3::uuid IS NOT NULL AND dentist_id=$3::uuid) OR chair=$4)
            AND start_time < ($5::time + make_interval(mins => $6::int))
            AND (start_time + make_interval(mins => duration)) > $5::time
          LIMIT 1`,
        [tenantId, apptDate, dentistId || null, chair, startTime, duration, id],
      );
      if (clashes.length) throw new SlotTakenError();

      const { rows } = await client.query(
        `UPDATE appointments
         SET dentist_id=$1, chair=$2, appt_date=$3::date, start_time=$4::time, duration=$5, type=$6, notes=$7
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
        ],
      );
      return rows[0];
    });
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return conflict('Este horário está ocupado — escolha outro.');
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
      `Consulta atualizada: ${String(updated.appt_date).slice(0, 10)} ${String(updated.start_time).slice(0, 5)} · ${updated.type}`,
    );
  }

  // Reagendar liberta o horário antigo tão a sério como um cancelamento liberta
  // o dele — e até agora esse espaço ficava simplesmente vazio, sem ninguém
  // saber. Vai à lista de espera pelo mesmo caminho do DELETE abaixo.
  const previousDate = String(prev.appt_date).slice(0, 10);
  const previousStart = String(prev.start_time).slice(0, 5);
  const moved = previousDate !== apptDate || previousStart !== startTime || Number(prev.chair) !== chair;
  if (moved && previousDate >= new Date().toISOString().slice(0, 10) && prev.tenant_id) {
    await notifyWaitlistOfFreedSlot(
      String(prev.tenant_id),
      {
        date: previousDate,
        startTime: previousStart,
        type: String(prev.type || ''),
        duration: Number(prev.duration),
        dentistId: (prev.dentist_id as string) || null,
        chair: Number(prev.chair) || 1,
      },
      null,
    ).catch((e) => {
      console.error('notifyWaitlistOfFreedSlot (remarcação) falhou:', e instanceof Error ? e.message : e);
    });
  }

  return Response.json(full || updated);
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'appointments:cancel'))) return forbidden();

  const { id } = await params;
  const tenantId = user.role === 'super_admin' ? null : user.tenantId;
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
}
