import { query, queryOne } from './db';

export interface CreateTaskInput {
  patientId: string | null;
  type?: string;
  title: string;
  notes?: string;
  dueAt?: string | null;
  assignedTo?: string | null;
}

export interface ListTasksFilter {
  patientId?: string | null;
  assignedTo?: string | null;
  status?: string | null;
}

export async function createTask(tenantId: string, createdBy: string | null, input: CreateTaskInput) {
  const [row] = await query(
    `INSERT INTO patient_tasks
       (tenant_id, patient_id, type, title, notes, due_at, assigned_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      tenantId,
      input.patientId || null,
      input.type || 'generic',
      input.title,
      input.notes || '',
      input.dueAt || null,
      input.assignedTo || null,
      createdBy,
    ],
  );
  return row;
}

export async function listTasks(tenantId: string, filter: ListTasksFilter = {}) {
  const vals: unknown[] = [tenantId];
  let sql = `
    SELECT t.*, p.name AS patient_name, u.name AS assigned_to_name, c.name AS created_by_name
    FROM patient_tasks t
    LEFT JOIN patients p ON p.id = t.patient_id
    LEFT JOIN users u ON u.id = t.assigned_to
    LEFT JOIN users c ON c.id = t.created_by
    WHERE t.tenant_id=$1`;
  if (filter.patientId) {
    vals.push(filter.patientId);
    sql += ` AND t.patient_id=$${vals.length}`;
  }
  if (filter.assignedTo) {
    vals.push(filter.assignedTo);
    sql += ` AND t.assigned_to=$${vals.length}`;
  }
  if (filter.status) {
    vals.push(filter.status);
    sql += ` AND t.status=$${vals.length}`;
  }
  sql += ' ORDER BY (t.due_at IS NULL), t.due_at, t.created_at DESC';
  return query(sql, vals);
}

export async function getTask(tenantId: string, id: string) {
  return queryOne(`SELECT * FROM patient_tasks WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
}

export async function updateTask(
  tenantId: string,
  id: string,
  updates: {
    title?: string;
    notes?: string;
    dueAt?: string | null;
    assignedTo?: string | null;
    status?: 'pending' | 'done' | 'cancelled';
  },
) {
  const prev = await getTask(tenantId, id);
  if (!prev) return null;
  const status = updates.status ?? prev.status;
  const completedAt = status === 'done' ? new Date().toISOString() : status === 'pending' ? null : prev.completed_at;
  const [row] = await query(
    `UPDATE patient_tasks
     SET title=$1, notes=$2, due_at=$3, assigned_to=$4, status=$5, completed_at=$6
     WHERE id=$7 AND tenant_id=$8
     RETURNING *`,
    [
      updates.title ?? prev.title,
      updates.notes !== undefined ? updates.notes : prev.notes,
      updates.dueAt !== undefined ? updates.dueAt : prev.due_at,
      updates.assignedTo !== undefined ? updates.assignedTo : prev.assigned_to,
      status,
      completedAt,
      id,
      tenantId,
    ],
  );
  return row;
}

// Called by app/api/uploads/route.ts once an upload resolves a pending
// document-request task — closes the task the same way a manual "Concluir"
// would, so the requester doesn't have to notice and do it by hand.
export async function completeTask(tenantId: string, id: string) {
  const [row] = await query(
    `UPDATE patient_tasks SET status='done', completed_at=NOW()
     WHERE id=$1 AND tenant_id=$2 AND status='pending'
     RETURNING *`,
    [id, tenantId],
  );
  return row || null;
}
