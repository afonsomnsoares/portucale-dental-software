import { query, queryOne } from './db';
import type { SchedulingPreferences } from './schedulingPrefsCalc';

// Item 9 — "preferências dos pacientes": a metade que toca na base de dados.
// lib/schedulingPrefsCalc.ts pontua um horário contra o perfil; aqui só se lê e
// escreve. Mesma divisão de lib/staffSchedule.ts vs lib/staffAvailabilityCalc.ts.

// Normaliza a linha crua para o formato que o módulo puro espera — nomes em
// camelCase, TIME cortado a 'HH:MM', array de dias sempre ordenado e sem
// duplicados (o Postgres aceita SMALLINT[] com repetições, o cálculo não ganha
// nada com elas e a UI mostraria "Segunda, Segunda").
function toPreferences(row: Record<string, unknown> | null): SchedulingPreferences | null {
  if (!row) return null;
  const days = Array.isArray(row.preferred_days) ? (row.preferred_days as number[]).map(Number) : null;
  return {
    preferredDentistId: (row.preferred_dentist_id as string) || null,
    preferredDays: days?.length ? [...new Set(days)].sort((a, b) => a - b) : null,
    preferredTimeStart: row.preferred_time_start ? String(row.preferred_time_start).slice(0, 5) : null,
    preferredTimeEnd: row.preferred_time_end ? String(row.preferred_time_end).slice(0, 5) : null,
  };
}

export async function getPreferences(tenantId: string, patientId: string) {
  const row = await queryOne(
    `SELECT ps.*, u.name AS preferred_dentist_name
     FROM patient_scheduling_prefs ps
     LEFT JOIN users u ON u.id = ps.preferred_dentist_id
     WHERE ps.tenant_id=$1 AND ps.patient_id=$2`,
    [tenantId, patientId],
  );
  return row;
}

// Só as preferências, no formato do módulo puro — o que lib/scheduling.ts precisa.
// Devolve null quando o doente nunca definiu nada, e não um objeto vazio: assim
// hasAnyPreference() e o ranking distinguem "sem preferências" de "preferências
// que não encaixam", que são casos diferentes.
export async function getPreferencesFor(tenantId: string, patientId: string): Promise<SchedulingPreferences | null> {
  const row = await queryOne(
    `SELECT preferred_dentist_id, preferred_days, preferred_time_start::text, preferred_time_end::text
     FROM patient_scheduling_prefs WHERE tenant_id=$1 AND patient_id=$2`,
    [tenantId, patientId],
  );
  return toPreferences(row);
}

// Versão em lote para o otimizador, que avalia dezenas de consultas de uma vez e
// não pode fazer uma query por doente. Doentes sem perfil simplesmente não
// aparecem no Map.
export async function getPreferencesForPatients(
  tenantId: string,
  patientIds: string[],
): Promise<Map<string, SchedulingPreferences>> {
  const map = new Map<string, SchedulingPreferences>();
  if (!patientIds.length) return map;
  const rows = await query(
    `SELECT patient_id, preferred_dentist_id, preferred_days,
            preferred_time_start::text, preferred_time_end::text
     FROM patient_scheduling_prefs
     WHERE tenant_id=$1 AND patient_id = ANY($2::uuid[])`,
    [tenantId, patientIds],
  );
  for (const r of rows) {
    const prefs = toPreferences(r);
    if (prefs) map.set(String(r.patient_id), prefs);
  }
  return map;
}

export interface UpsertPreferencesInput {
  preferredDentistId?: string | null;
  preferredDays?: number[] | null;
  preferredTimeStart?: string | null;
  preferredTimeEnd?: string | null;
  notes?: string;
}

// É um perfil, não um histórico — daí o UNIQUE(patient_id) na migração e o
// upsert aqui. Guardar um perfil totalmente vazio é permitido de propósito: é
// como se limpa uma preferência anterior sem ter de apagar a linha.
export async function upsertPreferences(
  tenantId: string,
  patientId: string,
  userId: string | null,
  input: UpsertPreferencesInput,
) {
  const days = input.preferredDays?.length ? [...new Set(input.preferredDays)].sort((a, b) => a - b) : null;
  const [row] = await query(
    `INSERT INTO patient_scheduling_prefs
       (tenant_id, patient_id, preferred_dentist_id, preferred_days, preferred_time_start, preferred_time_end, notes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (patient_id) DO UPDATE SET
       preferred_dentist_id = EXCLUDED.preferred_dentist_id,
       preferred_days       = EXCLUDED.preferred_days,
       preferred_time_start = EXCLUDED.preferred_time_start,
       preferred_time_end   = EXCLUDED.preferred_time_end,
       notes                = EXCLUDED.notes,
       updated_by           = EXCLUDED.updated_by
     RETURNING *`,
    [
      tenantId,
      patientId,
      input.preferredDentistId || null,
      days,
      input.preferredTimeStart || null,
      input.preferredTimeEnd || null,
      input.notes || '',
      userId,
    ],
  );
  return row;
}
