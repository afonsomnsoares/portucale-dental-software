import { query, queryOne } from './db';
import {
  type DocumentTemplateType,
  formatPtDate,
  formatPtTime,
  renderTemplate,
  unknownPlaceholders,
} from './documentsCalc';
import { PT_DOCUMENT_TEMPLATES } from './presets/documentTemplates';

// Item 10 — "documentação não clínica": orquestração à volta de lib/documentsCalc.ts
// (que é puro e não toca na base de dados). Aqui vive só o que precisa de SQL:
// os modelos, a recolha das variáveis a partir do paciente/consulta/clínica, e a
// gravação do documento emitido.
//
// Mesma convenção de lib/recovery.ts / lib/staffSchedule.ts: um módulo lib quando
// há lógica real a partilhar entre rotas, SQL simples inline nas rotas quando não há.

export interface TemplateInput {
  name: string;
  type: DocumentTemplateType;
  subject: string;
  body: string;
}

export async function listTemplates(tenantId: string, includeInactive = false) {
  return query(
    `SELECT * FROM document_templates
     WHERE tenant_id=$1 ${includeInactive ? '' : 'AND active=TRUE'}
     ORDER BY type, name`,
    [tenantId],
  );
}

export async function getTemplate(tenantId: string, id: string) {
  return queryOne(`SELECT * FROM document_templates WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
}

export async function createTemplate(tenantId: string, userId: string | null, input: TemplateInput) {
  const [row] = await query(
    `INSERT INTO document_templates (tenant_id, name, type, subject, body, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tenantId, input.name, input.type, input.subject, input.body, userId],
  );
  return row;
}

export async function updateTemplate(
  tenantId: string,
  id: string,
  updates: Partial<TemplateInput> & { active?: boolean },
) {
  const prev = await getTemplate(tenantId, id);
  if (!prev) return null;
  const [row] = await query(
    `UPDATE document_templates SET name=$1, type=$2, subject=$3, body=$4, active=$5
     WHERE id=$6 AND tenant_id=$7 RETURNING *`,
    [
      updates.name ?? prev.name,
      updates.type ?? prev.type,
      updates.subject !== undefined ? updates.subject : prev.subject,
      updates.body !== undefined ? updates.body : prev.body,
      updates.active !== undefined ? updates.active : prev.active,
      id,
      tenantId,
    ],
  );
  return row;
}

// Desativa em vez de apagar: generated_documents.template_id é ON DELETE SET NULL
// (ver 030_admin_documents.sql), por isso apagar não perderia histórico — mas
// perderia a ligação, e não há razão para o fazer. Um modelo inativo desaparece
// da lista de emissão e continua a explicar documentos já emitidos.
export async function deactivateTemplate(tenantId: string, id: string) {
  const [row] = await query(`UPDATE document_templates SET active=FALSE WHERE id=$1 AND tenant_id=$2 RETURNING *`, [
    id,
    tenantId,
  ]);
  return row || null;
}

// Insere os modelos PT que ainda não existam, comparando por nome — chamar duas
// vezes não duplica nada, e um modelo do preset que a clínica tenha entretanto
// reescrito nunca é revertido.
export async function seedPresetTemplates(tenantId: string, userId: string | null) {
  const existing = await query(`SELECT name FROM document_templates WHERE tenant_id=$1`, [tenantId]);
  const taken = new Set(existing.map((r) => String(r.name)));
  const created: unknown[] = [];
  for (const t of PT_DOCUMENT_TEMPLATES) {
    if (taken.has(t.name)) continue;
    created.push(await createTemplate(tenantId, userId, t));
  }
  return { created: created.length, skipped: PT_DOCUMENT_TEMPLATES.length - created.length, rows: created };
}

export interface BuildVariablesInput {
  patientId: string;
  appointmentId?: string | null;
  issuedByName: string;
}

export interface DocumentContext {
  patient: { id: string; name: string };
  appointmentId: string | null;
  variables: Record<string, string>;
}

// Resolve o catálogo de DOCUMENT_VARIABLES contra o estado atual do paciente,
// da consulta escolhida (opcional) e da clínica. Devolve null quando o paciente
// não pertence a este tenant — a rota trata isso como 404, mesmo padrão de
// lib/tenantGuard.ts's getOwnedPatient.
//
// Uma consulta que não seja do próprio paciente é ignorada em silêncio (fica
// sem as variáveis de consulta) em vez de erro: é uma referência opcional, e
// preencher uma declaração com a consulta de outra pessoa seria muito pior do
// que a deixar em branco.
async function buildDocumentContext(tenantId: string, input: BuildVariablesInput): Promise<DocumentContext | null> {
  const patient = await queryOne(
    `SELECT id, name, dob::text AS dob, phone, email, insurance
     FROM patients WHERE id=$1 AND tenant_id=$2`,
    [input.patientId, tenantId],
  );
  if (!patient) return null;

  const tenant = await queryOne(`SELECT name, city FROM tenants WHERE id=$1`, [tenantId]);

  let appointment: Record<string, unknown> | null = null;
  if (input.appointmentId) {
    appointment = await queryOne(
      `SELECT a.id, a.appt_date::text AS appt_date, a.start_time::text AS start_time,
              a.type, a.duration, u.name AS dentist_name
       FROM appointments a
       LEFT JOIN users u ON u.id = a.dentist_id
       WHERE a.id=$1 AND a.tenant_id=$2 AND a.patient_id=$3`,
      [input.appointmentId, tenantId, patient.id],
    );
  }

  const variables: Record<string, string> = {
    paciente_nome: String(patient.name || ''),
    paciente_dob: formatPtDate(patient.dob),
    paciente_telefone: String(patient.phone || ''),
    paciente_email: String(patient.email || ''),
    paciente_seguro: String(patient.insurance || ''),
    consulta_data: formatPtDate(appointment?.appt_date),
    consulta_hora: formatPtTime(appointment?.start_time),
    consulta_tipo: String(appointment?.type || ''),
    consulta_duracao: appointment?.duration ? String(appointment.duration) : '',
    dentista_nome: String(appointment?.dentist_name || ''),
    clinica_nome: String(tenant?.name || ''),
    clinica_cidade: String(tenant?.city || ''),
    emitido_por: input.issuedByName,
    data_hoje: formatPtDate(new Date().toLocaleDateString('en-CA')),
  };

  return {
    patient: { id: String(patient.id), name: String(patient.name) },
    appointmentId: appointment ? String(appointment.id) : null,
    variables,
  };
}

export interface GenerateDocumentInput {
  templateId: string;
  patientId: string;
  appointmentId?: string | null;
  // Sobreposições escritas à mão na altura de emitir (ex.: uma data diferente
  // da consulta). Só chaves do catálogo são aceites — filtradas na rota.
  overrides?: Record<string, string>;
}

export type GenerateResult =
  | { ok: true; row: Record<string, unknown>; missing: string[] }
  | { ok: false; status: number; error: string };

export async function generateDocument(
  tenantId: string,
  user: { id: string | null; name: string },
  input: GenerateDocumentInput,
): Promise<GenerateResult> {
  const template = await getTemplate(tenantId, input.templateId);
  if (!template) return { ok: false, status: 404, error: 'Template not found' };
  if (!template.active) return { ok: false, status: 400, error: 'Template is inactive' };

  const ctx = await buildDocumentContext(tenantId, {
    patientId: input.patientId,
    appointmentId: input.appointmentId || null,
    issuedByName: user.name,
  });
  if (!ctx) return { ok: false, status: 404, error: 'Patient not found' };

  const variables = { ...ctx.variables, ...(input.overrides || {}) };
  const renderedBody = renderTemplate(String(template.body || ''), variables);
  const renderedTitle = renderTemplate(String(template.subject || template.name), variables);

  const [row] = await query(
    `INSERT INTO generated_documents
       (tenant_id, template_id, template_name, type, patient_id, patient_name,
        appointment_id, title, body, variables, issued_by, issued_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
     RETURNING *`,
    [
      tenantId,
      template.id,
      template.name,
      template.type,
      ctx.patient.id,
      ctx.patient.name,
      ctx.appointmentId,
      renderedTitle.text,
      renderedBody.text,
      JSON.stringify(variables),
      user.id,
      user.name,
    ],
  );

  // Só os marcadores do corpo interessam ao utilizador — um título com um campo
  // por preencher é cosmético, o corpo é o que vai ser entregue.
  return { ok: true, row, missing: renderedBody.missing };
}

export async function listDocuments(tenantId: string, filter: { patientId?: string | null; limit?: number } = {}) {
  const vals: unknown[] = [tenantId];
  let sql = `SELECT * FROM generated_documents WHERE tenant_id=$1`;
  if (filter.patientId) {
    vals.push(filter.patientId);
    sql += ` AND patient_id=$${vals.length}`;
  }
  vals.push(Math.max(1, Math.min(500, filter.limit || 100)));
  sql += ` ORDER BY created_at DESC LIMIT $${vals.length}`;
  return query(sql, vals);
}

export async function getDocument(tenantId: string, id: string) {
  return queryOne(`SELECT * FROM generated_documents WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
}

// Re-exportado para a rota de modelos poder avisar quem escreve o modelo sem ter
// de importar dos dois sítios.
export { unknownPlaceholders };
