import { query, queryOne } from './db';
import {
  buildHandoffItems,
  currentOrLastBlock,
  type HandoffSignals,
  type ShiftLabel,
  shiftLabelForBlock,
} from './shiftHandoffCalc';
import type { ScheduleBlock } from './staffAvailabilityCalc';

// Item 11 — "handoffs": a metade que toca na base de dados. lib/shiftHandoffCalc.ts
// decide o rótulo do turno e compõe as linhas; aqui recolhem-se os sinais e
// gravam-se as passagens. Mesma divisão de lib/staffSchedule.ts vs
// lib/staffAvailabilityCalc.ts.

export interface HandoffDraft {
  date: string;
  shiftLabel: ShiftLabel;
  items: string[];
  // Sinais em bruto, para a UI poder mostrar contagens sem ter de voltar a
  // interpretar as linhas de texto.
  signals: HandoffSignals;
}

async function loadShiftBlocks(tenantId: string, userId: string, weekday: number): Promise<ScheduleBlock[]> {
  const rows = await query(
    `SELECT start_time, end_time FROM staff_schedules WHERE tenant_id=$1 AND user_id=$2 AND weekday=$3`,
    [tenantId, userId, weekday],
  );
  return rows.map((r) => ({
    weekday,
    startTime: String(r.start_time).slice(0, 5),
    endTime: String(r.end_time).slice(0, 5),
  }));
}

// O rascunho que aparece pré-preenchido no compositor da passagem: o que está
// mesmo pendente na clínica neste momento. As tarefas são as de quem está a sair
// (mais as da fila partilhada, que também ficam para o turno seguinte); os
// incidentes, checklists, doentes e ofertas são de toda a clínica, porque quem
// entra herda-os independentemente de quem os abriu.
export async function computeHandoffDraft(
  tenantId: string,
  userId: string,
  at: Date = new Date(),
): Promise<HandoffDraft> {
  const dateStr = at.toLocaleDateString('en-CA');
  const blocks = await loadShiftBlocks(tenantId, userId, at.getDay());
  const shiftLabel = shiftLabelForBlock(currentOrLastBlock(blocks, at));

  const [tasks, incidents, checklists, patients, offers] = await Promise.all([
    query(
      `SELECT t.title, t.due_at, p.name AS patient_name
       FROM patient_tasks t
       LEFT JOIN patients p ON p.id = t.patient_id
       WHERE t.tenant_id=$1 AND t.status='pending'
         AND (t.assigned_to = $2 OR t.assigned_to IS NULL)
       ORDER BY (t.due_at IS NULL), t.due_at
       LIMIT 25`,
      [tenantId, userId],
    ),
    query(
      `SELECT title, severity FROM incidents
       WHERE tenant_id=$1 AND status IN ('open','in_progress')
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
       LIMIT 15`,
      [tenantId],
    ),
    query(
      `SELECT template_name AS name FROM checklist_runs
       WHERE tenant_id=$1 AND run_date=$2::date AND status='in_progress'
       ORDER BY template_name`,
      [tenantId, dateStr],
    ),
    query(
      `SELECT name, status FROM patients
       WHERE tenant_id=$1 AND status IN ('waiting','in-operatory','ready-dismissal')
       ORDER BY name`,
      [tenantId],
    ),
    queryOne(`SELECT COUNT(*)::int AS count FROM slot_offers WHERE tenant_id=$1 AND status='sent'`, [tenantId]),
  ]);

  const now = at.getTime();
  const signals: HandoffSignals = {
    openTasks: tasks.map((t) => ({
      title: String(t.title),
      patientName: t.patient_name ? String(t.patient_name) : null,
      overdue: !!t.due_at && new Date(t.due_at).getTime() < now,
    })),
    openIncidents: incidents.map((i) => ({ title: String(i.title), severity: String(i.severity) })),
    unfinishedChecklists: checklists.map((c) => ({ name: String(c.name) })),
    patientsInClinic: patients.map((p) => ({ name: String(p.name), status: String(p.status) })),
    pendingWaitlistOffers: Number(offers?.count || 0),
  };

  return { date: dateStr, shiftLabel, items: buildHandoffItems(signals), signals };
}

export interface CreateHandoffInput {
  handoffDate: string;
  shiftLabel: ShiftLabel;
  toUserId?: string | null;
  notes?: string;
  items?: string[];
}

export async function createHandoff(tenantId: string, fromUserId: string, input: CreateHandoffInput) {
  const [row] = await query(
    `INSERT INTO shift_handoffs (tenant_id, handoff_date, shift_label, from_user_id, to_user_id, notes, items)
     VALUES ($1,$2::date,$3,$4,$5,$6,$7::jsonb)
     RETURNING *`,
    [
      tenantId,
      input.handoffDate,
      input.shiftLabel,
      fromUserId,
      input.toUserId || null,
      input.notes || '',
      JSON.stringify(input.items || []),
    ],
  );
  return row;
}

export interface ListHandoffsFilter {
  date?: string | null;
  status?: string | null;
  // 'para mim': passagens dirigidas a este utilizador ou deixadas em aberto para
  // o turno seguinte (to_user_id NULL), excluindo as que ele próprio escreveu.
  forUserId?: string | null;
}

export async function listHandoffs(tenantId: string, filter: ListHandoffsFilter = {}) {
  const vals: unknown[] = [tenantId];
  let sql = `
    SELECT h.*, f.name AS from_user_name, t.name AS to_user_name, a.name AS acknowledged_by_name
    FROM shift_handoffs h
    JOIN users f ON f.id = h.from_user_id
    LEFT JOIN users t ON t.id = h.to_user_id
    LEFT JOIN users a ON a.id = h.acknowledged_by
    WHERE h.tenant_id=$1`;
  if (filter.date) {
    vals.push(filter.date);
    sql += ` AND h.handoff_date = $${vals.length}::date`;
  }
  if (filter.status) {
    vals.push(filter.status);
    sql += ` AND h.status = $${vals.length}`;
  }
  if (filter.forUserId) {
    vals.push(filter.forUserId);
    sql += ` AND (h.to_user_id = $${vals.length} OR h.to_user_id IS NULL) AND h.from_user_id <> $${vals.length}`;
  }
  sql += ' ORDER BY h.handoff_date DESC, h.created_at DESC LIMIT 200';
  return query(sql, vals);
}

export async function getHandoff(tenantId: string, id: string) {
  return queryOne(`SELECT * FROM shift_handoffs WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
}

// Quem escreveu a passagem não a pode confirmar a si próprio — o objetivo da
// confirmação é provar que o turno seguinte leu, e não haveria prova nenhuma se
// bastasse o próprio autor carregar no botão. Devolve null nesse caso, tal como
// quando a passagem não existe; a rota distingue os dois.
export async function acknowledgeHandoff(tenantId: string, id: string, userId: string) {
  const [row] = await query(
    `UPDATE shift_handoffs
     SET status='acknowledged', acknowledged_by=$1, acknowledged_at=NOW()
     WHERE id=$2 AND tenant_id=$3 AND status='open' AND from_user_id <> $1
     RETURNING *`,
    [userId, id, tenantId],
  );
  return row || null;
}
