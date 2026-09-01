import { query } from './db';

export interface LogInteractionInput {
  patientId: string;
  channel: string;
  direction: string;
  summary: string;
  occurredAt?: string | null;
}

export async function logInteraction(tenantId: string, createdBy: string | null, input: LogInteractionInput) {
  const [row] = await query(
    `INSERT INTO patient_interactions (tenant_id, patient_id, channel, direction, summary, occurred_at, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, NOW()),$7)
     RETURNING *`,
    [tenantId, input.patientId, input.channel, input.direction, input.summary, input.occurredAt || null, createdBy],
  );
  return row;
}

export async function listInteractions(tenantId: string, patientId: string) {
  return query(
    `SELECT i.*, u.name AS created_by_name
     FROM patient_interactions i
     LEFT JOIN users u ON u.id = i.created_by
     WHERE i.tenant_id=$1 AND i.patient_id=$2
     ORDER BY i.occurred_at DESC`,
    [tenantId, patientId],
  );
}
