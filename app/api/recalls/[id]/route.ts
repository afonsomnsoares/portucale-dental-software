import type { NextRequest } from 'next/server';
import { appendAudit, appendTimeline } from '@/lib/audit';
import { forbidden, getAuth, requireSameOrigin, unauthorized } from '@/lib/auth';
import { query, queryOne } from '@/lib/db';
import { hasPermission } from '@/lib/permissions';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'recalls:manage'))) return forbidden();
  const { id } = await params;
  const body = await request.json();

  const prev = await queryOne(`SELECT * FROM recalls WHERE id=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid)`, [
    id,
    user.tenantId || null,
  ]);
  if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

  let lastDone = body.lastDone ?? prev.last_done;
  let nextDue = body.nextDue ?? prev.next_due;
  const active = body.active !== undefined ? body.active : prev.active;

  if (body.complete === true) {
    const today = new Date().toISOString().slice(0, 10);
    lastDone = today;
    const interval = body.intervalMonths ?? prev.interval_months;
    const d = new Date(today);
    d.setMonth(d.getMonth() + interval);
    nextDue = d.toISOString().slice(0, 10);
  }

  const [updated] = await query(
    `UPDATE recalls
     SET recall_type=$1, interval_months=$2, last_done=$3, next_due=$4,
         notes=$5, active=$6, updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [
      body.recallType ?? prev.recall_type,
      body.intervalMonths ?? prev.interval_months,
      lastDone,
      nextDue,
      body.notes ?? prev.notes,
      active,
      id,
    ],
  );

  if (body.complete === true) {
    await appendTimeline(
      prev.patient_id,
      user,
      'admin',
      `Recall concluído: ${prev.recall_type} — próximo previsto ${updated.next_due}`,
    );
  }
  await appendAudit(
    user,
    'UPDATE',
    `Recall: ${prev.recall_type}`,
    `active:${prev.active}`,
    `active:${updated.active}`,
    user.clinic,
  );

  return Response.json(updated);
}
