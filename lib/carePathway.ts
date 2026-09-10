import {
  type DuePathwayStep,
  dueStepsFor,
  type PathwayContext,
  type PathwayEvidence,
  type PathwayStep,
  previewPathway,
  stepKey,
  validatePathwaySteps,
} from './carePathwayCalc';
import { query, queryRead } from './db';
import { findMissingFields } from './missingData';
import { createTask } from './patientTasks';

// Liga lib/carePathwayCalc.ts às tabelas da migração 048. A decisão de o que está
// devido vive lá (pura, testada); aqui lê-se a realidade e criam-se as tarefas.
//
// Quão longe olha para a frente. Catorze dias é o mesmo horizonte da previsão de
// consumo de material (PROCEDURE_FORECAST_DAYS) — e pela mesma razão: é o prazo em que
// uma clínica consegue mesmo fazer alguma coisa com o aviso.
const PATHWAY_HORIZON_DAYS = 14;
// Até quando se continua a produzir passos pós-consulta. Sem um limite, uma consulta de
// 2019 sem recall criado voltaria a gerar a mesma tarefa todos os dias para sempre.
const PATHWAY_LOOKBACK_DAYS = 30;

export interface PathwayTemplate {
  id: string;
  appointmentType: string;
  name: string;
  description: string;
  active: boolean;
  steps: PathwayStep[];
}

function toStep(row: Record<string, unknown>): PathwayStep {
  return {
    id: String(row.id),
    position: Number(row.position) || 1,
    phase: row.phase === 'post' ? 'post' : 'pre',
    action: String(row.action) as PathwayStep['action'],
    title: String(row.title),
    offsetDays: Number(row.offset_days) || 0,
    roles: Array.isArray(row.roles) ? (row.roles as string[]) : [],
    blocking: Boolean(row.blocking),
    reference: (row.reference as string) || null,
  };
}

export async function listPathwayTemplates(tenantId: string): Promise<PathwayTemplate[]> {
  const [templates, steps] = await Promise.all([
    queryRead(`SELECT * FROM care_pathway_templates WHERE tenant_id=$1 ORDER BY appointment_type, name`, [tenantId]),
    queryRead(
      `SELECT s.* FROM care_pathway_steps s
       JOIN care_pathway_templates t ON t.id = s.template_id
       WHERE s.tenant_id=$1 ORDER BY s.position, s.id`,
      [tenantId],
    ),
  ]);
  const stepsByTemplate = new Map<string, PathwayStep[]>();
  for (const s of steps) {
    const list = stepsByTemplate.get(String(s.template_id)) || [];
    list.push(toStep(s));
    stepsByTemplate.set(String(s.template_id), list);
  }
  return templates.map((t) => ({
    id: String(t.id),
    appointmentType: String(t.appointment_type),
    name: String(t.name),
    description: String(t.description || ''),
    active: Boolean(t.active),
    steps: stepsByTemplate.get(String(t.id)) || [],
  }));
}

export type SaveTemplateResult =
  | { ok: true; template: PathwayTemplate }
  | { ok: false; status: number; errors: string[] };

// Grava o template e os passos em bloco. Os passos são substituídos por inteiro em vez
// de reconciliados linha a linha: um template é uma coisa pequena que se edita num
// formulário, e uma reconciliação parcial abriria a porta a estados intermédios — um
// passo apagado e o seguinte por gravar — que não têm significado nenhum.
export async function savePathwayTemplate(
  tenantId: string,
  userId: string | null,
  input: {
    id?: string;
    appointmentType: string;
    name: string;
    description?: string;
    active?: boolean;
    steps: PathwayStep[];
  },
): Promise<SaveTemplateResult> {
  // A validação corre ANTES de qualquer escrita, e é a mesma função que a UI usa para
  // pré-visualizar — as duas não podem discordar sobre o que é um template válido.
  const errors = validatePathwaySteps(input.steps);
  if (errors.length) return { ok: false, status: 400, errors };
  if (!input.appointmentType?.trim()) return { ok: false, status: 400, errors: ['Tipo de consulta em falta.'] };
  if (!input.name?.trim()) return { ok: false, status: 400, errors: ['Nome em falta.'] };

  const [template] = input.id
    ? await query(
        `UPDATE care_pathway_templates
         SET appointment_type=$3, name=$4, description=$5, active=$6, updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2 RETURNING *`,
        [input.id, tenantId, input.appointmentType, input.name, input.description || '', input.active !== false],
      )
    : await query(
        `INSERT INTO care_pathway_templates (tenant_id, appointment_type, name, description, active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [tenantId, input.appointmentType, input.name, input.description || '', input.active !== false, userId],
      );
  if (!template) return { ok: false, status: 404, errors: ['Percurso não encontrado.'] };

  await query(`DELETE FROM care_pathway_steps WHERE template_id=$1 AND tenant_id=$2`, [template.id, tenantId]);
  for (const [i, s] of input.steps.entries()) {
    await query(
      `INSERT INTO care_pathway_steps
         (tenant_id, template_id, position, phase, action, title, offset_days, roles, blocking, reference)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenantId,
        template.id,
        i + 1,
        s.phase,
        s.action,
        s.title,
        s.offsetDays,
        s.roles || [],
        s.blocking,
        s.reference || null,
      ],
    );
  }

  const saved = (await listPathwayTemplates(tenantId)).find((t) => t.id === String(template.id));
  return saved ? { ok: true, template: saved } : { ok: false, status: 500, errors: ['Falha ao reler o percurso.'] };
}

export { previewPathway };

// ─── O motor ────────────────────────────────────────────────────────────────

// Reúne a prova de que cada passo já está satisfeito. É esta função que torna o motor
// idempotente: em vez de guardar progresso, pergunta à realidade. Uma consulta cujo
// consentimento foi assinado pelo caminho normal deixa de gerar o passo sozinha.
async function gatherEvidence(tenantId: string, apptIds: string[], patientIds: string[]) {
  const [markers, consents, documents, recalls, patients, schemaFields] = await Promise.all([
    // O marcador vai em patient_tasks.notes, exatamente como os lembretes de checklist
    // e de manutenção já fazem em lib/jobsRunner.ts. Tarefas CONCLUÍDAS contam: um
    // passo feito ontem não pode voltar a ser devido hoje.
    queryRead(`SELECT notes FROM patient_tasks WHERE tenant_id=$1 AND notes LIKE 'pathway:%'`, [tenantId]),
    queryRead(
      // Sem filtro de estado: `consent_forms` não tem coluna `status` (a definição
      // em vigor é a de scripts/schema.sql — o CREATE TABLE IF NOT EXISTS da migração
      // 021 nunca chegou a correr sobre uma base que já tinha a tabela). Uma linha aqui
      // É um consentimento assinado; `signed_by` é obrigatório e prova-o.
      `SELECT patient_id, procedure_name FROM consent_forms
       WHERE tenant_id=$1 AND patient_id = ANY($2::uuid[])`,
      [tenantId, patientIds],
    ),
    queryRead(
      `SELECT appointment_id, template_name, type FROM generated_documents
       WHERE tenant_id=$1 AND appointment_id = ANY($2::uuid[])`,
      [tenantId, apptIds],
    ),
    queryRead(
      `SELECT patient_id, recall_type FROM recalls
       WHERE tenant_id=$1 AND patient_id = ANY($2::uuid[]) AND active=TRUE`,
      [tenantId, patientIds],
    ),
    queryRead(
      `SELECT id, phone, email, dob, custom_fields FROM patients
       WHERE tenant_id=$1 AND id = ANY($2::uuid[])`,
      [tenantId, patientIds],
    ),
    queryRead(`SELECT field_name, label, required, rollout FROM schema_fields WHERE tenant_id=$1`, [tenantId]),
  ]);

  const markerSet = new Set(markers.map((m) => String(m.notes).split(/\s/)[0]));
  const consentsByPatient = new Map<string, Set<string>>();
  for (const c of consents) {
    const set = consentsByPatient.get(String(c.patient_id)) || new Set<string>();
    set.add(String(c.procedure_name));
    consentsByPatient.set(String(c.patient_id), set);
  }
  const docsByAppt = new Map<string, Set<string>>();
  for (const d of documents) {
    const set = docsByAppt.get(String(d.appointment_id)) || new Set<string>();
    set.add(String(d.template_name));
    set.add(String(d.type));
    docsByAppt.set(String(d.appointment_id), set);
  }
  const recallsByPatient = new Map<string, Set<string>>();
  for (const r of recalls) {
    const set = recallsByPatient.get(String(r.patient_id)) || new Set<string>();
    set.add(String(r.recall_type));
    recallsByPatient.set(String(r.patient_id), set);
  }
  const missingByPatient = new Map<string, string[]>();
  for (const p of patients) {
    missingByPatient.set(
      String(p.id),
      findMissingFields(
        { phone: p.phone, email: p.email, dob: p.dob, custom_fields: p.custom_fields },
        schemaFields as never,
      ).map((f) => f.label),
    );
  }

  return { markerSet, consentsByPatient, docsByAppt, recallsByPatient, missingByPatient };
}

export interface PathwayRunResult {
  scanned: number;
  due: number;
  created: number;
  blocking: number;
}

// Corre o motor: encontra os passos devidos e cria a tarefa de cada um. Pode correr
// tantas vezes por dia quantas se quiser — ver o comentário de idempotência no
// cabeçalho de lib/carePathwayCalc.ts.
export async function runCarePathways(
  tenantId: string,
  dryRun = false,
): Promise<PathwayRunResult & { steps: DuePathwayStep[] }> {
  const templates = (await listPathwayTemplates(tenantId)).filter((t) => t.active && t.steps.length);
  if (!templates.length) return { scanned: 0, due: 0, created: 0, blocking: 0, steps: [] };

  const byType = new Map(templates.map((t) => [t.appointmentType.toLowerCase(), t]));
  const appts = await queryRead(
    `SELECT a.id, a.patient_id, a.appt_date::text AS appt_date, a.type, a.status,
            COALESCE(p.name, a.patient_name, '—') AS patient_name
     FROM appointments a
     LEFT JOIN patients p ON p.id = a.patient_id
     WHERE a.tenant_id=$1
       AND a.appt_date BETWEEN CURRENT_DATE - ($2::int * INTERVAL '1 day')
                           AND CURRENT_DATE + ($3::int * INTERVAL '1 day')
       AND lower(a.type) = ANY($4::text[])
     ORDER BY a.appt_date`,
    [tenantId, PATHWAY_LOOKBACK_DAYS, PATHWAY_HORIZON_DAYS, Array.from(byType.keys())],
  );
  if (!appts.length) return { scanned: 0, due: 0, created: 0, blocking: 0, steps: [] };

  const evidence = await gatherEvidence(
    tenantId,
    appts.map((a) => String(a.id)),
    [...new Set(appts.map((a) => a.patient_id).filter(Boolean))].map(String),
  );
  const today = new Date().toLocaleDateString('en-CA');

  const allDue: DuePathwayStep[] = [];
  for (const a of appts) {
    const template = byType.get(String(a.type).toLowerCase());
    if (!template) continue;
    const patientId = a.patient_id ? String(a.patient_id) : null;
    const context: PathwayContext = {
      appointmentId: String(a.id),
      patientId,
      patientName: String(a.patient_name),
      apptDate: String(a.appt_date),
      type: String(a.type),
      status: String(a.status),
    };
    const ev: PathwayEvidence = {
      satisfiedStepIds: evidence.markerSet,
      signedConsents: (patientId && evidence.consentsByPatient.get(patientId)) || new Set(),
      generatedDocuments: evidence.docsByAppt.get(String(a.id)) || new Set(),
      missingFields: (patientId && evidence.missingByPatient.get(patientId)) || [],
      activeRecalls: (patientId && evidence.recallsByPatient.get(patientId)) || new Set(),
    };
    allDue.push(...dueStepsFor(context, template.steps, ev, today));
  }

  let created = 0;
  if (!dryRun) {
    for (const d of allDue) {
      await createTask(tenantId, null, {
        patientId: d.context.patientId,
        type: 'generic',
        // O marcador é a PRIMEIRA coisa nas notas, para a varredura de idempotência o
        // poder encontrar com um LIKE em vez de um scan de texto completo.
        notes: `${d.key} ${d.reason}`,
        title: d.step.blocking
          ? `⚠ ${d.step.title} — ${d.context.patientName}`
          : `${d.step.title} — ${d.context.patientName}`,
        dueAt: `${d.dueDate}T09:00:00Z`,
        preferredRoles: d.step.roles.length ? d.step.roles : undefined,
        autoAssign: true,
      });
      created += 1;
    }
  }

  return {
    scanned: appts.length,
    due: allDue.length,
    created,
    blocking: allDue.filter((d) => d.step.blocking).length,
    steps: allDue,
  };
}

export { stepKey };
