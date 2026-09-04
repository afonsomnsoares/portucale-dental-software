import { query, queryOne } from './db';

// ─── Direitos do titular dos dados (RGPD, artigos 15 a 20) ───────────────────
// A tabela `data_subject_requests` existia desde o schema inicial, com o CHECK
// dos seis tipos de pedido no sítio certo — e nenhuma linha de código a ler ou
// escrever nela. Registar o pedido não é cumpri-lo: o artigo 12.º dá um mês para
// responder, e sem forma de exportar ou apagar os dados o prazo não é cumprível.
// Este ficheiro é a máquina que falta.
//
// ⚠️ LIMITE DESTE FICHEIRO. Isto implementa a mecânica, não a decisão jurídica.
// As disposições abaixo assumem o entendimento corrente para uma clínica
// dentária em Portugal — que o processo clínico e os documentos fiscais têm
// obrigações de conservação que se sobrepõem ao direito ao apagamento (artigo
// 17.º, n.º 3, alínea b): tratamento necessário ao cumprimento de obrigação
// legal. Os prazos concretos NÃO estão fixados aqui de propósito: vivem em
// `data_retention_policies`, por clínica, para que quem os define seja quem tem
// competência para o fazer. Confirmar com jurista antes de produção.

export type Disposition = 'export' | 'anonymize' | 'delete' | 'exclude';

export interface PatientTableRule {
  table: string;
  disposition: Disposition;
  why: string;
  // Nem toda a tabela ligada a um paciente tem `tenant_id`: `patient_alerts` e
  // `patient_timeline` são delimitadas apenas pelo paciente, que por sua vez já
  // foi confirmado como sendo da clínica de quem chama. Filtrar por uma coluna
  // que não existe é um erro 42703 em runtime, por isso a forma da tabela vive
  // aqui — e o teste de cobertura compara-a com o catálogo do Postgres, para
  // que acrescentar `tenant_id` a uma delas não deixe esta lista a mentir.
  tenantScoped: boolean;
}

// Toda a tabela com coluna `patient_id` tem de aparecer aqui. Não é uma lista
// de conveniência: test/integration/data-subject-coverage.test.ts compara-a com
// o catálogo do Postgres e falha se alguém acrescentar uma tabela ligada a um
// paciente sem decidir o que lhe acontece num pedido de acesso ou apagamento.
// Sem isso, esta lista ficaria desatualizada exatamente como a lista de RLS do
// schema.sql ficou.
export const PATIENT_TABLE_RULES: PatientTableRule[] = [
  // ── Dados que o titular tem direito a receber (art. 15.º e 20.º) ──────────
  {
    table: 'appointments',
    disposition: 'anonymize',
    why: 'Registo clínico — conservado, identidade removida',
    tenantScoped: true,
  },
  {
    table: 'treatments',
    disposition: 'anonymize',
    why: 'Registo clínico — conservado, identidade removida',
    tenantScoped: true,
  },
  {
    table: 'medical_history',
    disposition: 'anonymize',
    why: 'Registo clínico — conservado, identidade removida',
    tenantScoped: true,
  },
  {
    table: 'prescriptions',
    disposition: 'anonymize',
    why: 'Registo clínico — conservado, identidade removida',
    tenantScoped: true,
  },
  {
    table: 'treatment_plans',
    disposition: 'anonymize',
    why: 'Registo clínico — conservado, identidade removida',
    tenantScoped: true,
  },
  {
    table: 'lab_orders',
    disposition: 'anonymize',
    why: 'Registo clínico — conservado, identidade removida',
    tenantScoped: true,
  },
  { table: 'consent_forms', disposition: 'anonymize', why: 'Prova de consentimento — conservada', tenantScoped: true },
  {
    table: 'invoices',
    disposition: 'anonymize',
    why: 'Documento fiscal — conservação obrigatória',
    tenantScoped: true,
  },
  { table: 'patient_timeline', disposition: 'anonymize', why: 'Trilho de auditoria append-only', tenantScoped: false },
  {
    table: 'patient_data_consents',
    disposition: 'anonymize',
    why: 'Prova de consentimento — conservada',
    tenantScoped: true,
  },

  // ── Dados operacionais: sem valor clínico ou fiscal depois do apagamento ──
  { table: 'patient_alerts', disposition: 'delete', why: 'Nota operacional', tenantScoped: false },
  { table: 'patient_tasks', disposition: 'delete', why: 'Trabalho interno sobre o paciente', tenantScoped: true },
  { table: 'patient_interactions', disposition: 'delete', why: 'Registo de contactos', tenantScoped: true },
  { table: 'recalls', disposition: 'delete', why: 'Agendamento de convocatórias', tenantScoped: true },
  {
    table: 'notifications',
    disposition: 'delete',
    why: 'Mensagens enviadas — contêm nome e telefone',
    tenantScoped: true,
  },
  { table: 'uploads', disposition: 'delete', why: 'Ficheiros — apagados também do armazenamento', tenantScoped: true },
  {
    table: 'generated_documents',
    disposition: 'delete',
    why: 'Documentos gerados a partir dos dados',
    tenantScoped: true,
  },
  { table: 'patient_lifecycle_state', disposition: 'delete', why: 'Segmentação de marketing', tenantScoped: true },
  { table: 'patient_scheduling_prefs', disposition: 'delete', why: 'Preferências de marcação', tenantScoped: true },
  { table: 'waitlist_entries', disposition: 'delete', why: 'Lista de espera', tenantScoped: true },
  { table: 'slot_offers', disposition: 'delete', why: 'Ofertas de vaga', tenantScoped: true },
  // As respostas por SMS do próprio titular (migração 046). Apagam-se, e não se
  // anonimizam: o conteúdo É a mensagem que ele escreveu, e uma mensagem sem
  // remetente não passa a ser anónima — continua a dizer o que a pessoa disse
  // sobre a sua saúde e os seus horários. É o mesmo raciocínio que já se aplica
  // a `notifications` (mensagens enviadas) e a `patient_interactions`.
  { table: 'sms_inbound', disposition: 'delete', why: 'Respostas por SMS do titular', tenantScoped: true },
  { table: 'appointment_cancellations', disposition: 'delete', why: 'Motivos de cancelamento', tenantScoped: true },
  { table: 'leads', disposition: 'delete', why: 'Contacto comercial anterior ao registo', tenantScoped: true },

  // ── Fora do âmbito ───────────────────────────────────────────────────────
  {
    table: 'patient_portal_tokens',
    disposition: 'exclude',
    why: 'Credenciais efémeras de uso único, não dados pessoais do titular',
    tenantScoped: true,
  },
  {
    table: 'data_subject_requests',
    disposition: 'exclude',
    why: 'O próprio pedido — apagá-lo destruiria a prova de que foi cumprido',
    tenantScoped: true,
  },
];

const RULES_BY_TABLE = new Map(PATIENT_TABLE_RULES.map((r) => [r.table, r]));

/**
 * Reúne tudo o que a clínica guarda sobre um paciente, tabela a tabela.
 * Serve os pedidos de acesso (art. 15.º) e de portabilidade (art. 20.º) — o
 * mesmo conteúdo, e por isso a mesma função; o art. 20.º exige apenas que o
 * formato seja estruturado e legível por máquina, que é o que o JSON é.
 */
export async function exportPatientData(tenantId: string, patientId: string) {
  const patient = await queryOne(`SELECT * FROM patients WHERE id=$1 AND tenant_id=$2`, [patientId, tenantId]);
  if (!patient) return null;

  const related: Record<string, unknown[]> = {};
  for (const rule of PATIENT_TABLE_RULES) {
    if (rule.disposition === 'exclude') continue;
    const where = rule.tenantScoped ? 'patient_id=$1 AND tenant_id=$2' : 'patient_id=$1';
    const args = rule.tenantScoped ? [patientId, tenantId] : [patientId];
    try {
      related[rule.table] = await query(
        `SELECT * FROM ${rule.table} WHERE ${where} ORDER BY created_at NULLS LAST`,
        args,
      );
    } catch {
      // Nem todas têm created_at; repetir sem ordenação em vez de perder a tabela.
      related[rule.table] = await query(`SELECT * FROM ${rule.table} WHERE ${where}`, args);
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    subject: patient,
    records: related,
    // Sem isto o titular recebe linhas sem saber o que são. O art. 15.º, n.º 1,
    // exige informar sobre as finalidades e os prazos, não apenas entregar dados.
    notes: PATIENT_TABLE_RULES.filter((r) => r.disposition !== 'exclude').map((r) => ({
      table: r.table,
      treatment: r.disposition,
      rationale: r.why,
    })),
  };
}

export interface ErasureResult {
  anonymized: Record<string, number>;
  deleted: Record<string, number>;
  storageKeys: string[];
}

/**
 * Executa um pedido de apagamento (art. 17.º).
 *
 * Não é um DELETE do paciente. As linhas com valor clínico ou fiscal ficam — a
 * lei obriga a conservá-las — e o que desaparece é a ligação a uma pessoa
 * identificável: a linha de `patients` mantém-se como âncora das chaves
 * estrangeiras, mas esvaziada de tudo o que identifica. É o que torna o registo
 * clínico anónimo em vez de o destruir, e é por isso que as marcações e faturas
 * continuam a somar nos relatórios da clínica depois de um apagamento.
 *
 * Devolve as chaves de armazenamento dos ficheiros apagados para o chamador os
 * remover do R2 ou do disco — esta função não toca em I/O fora da base de dados.
 */
export async function erasePatient(tenantId: string, patientId: string): Promise<ErasureResult | null> {
  const patient = await queryOne(`SELECT id FROM patients WHERE id=$1 AND tenant_id=$2`, [patientId, tenantId]);
  if (!patient) return null;

  const anonymized: Record<string, number> = {};
  const deleted: Record<string, number> = {};

  // Recolher antes de apagar: depois do DELETE não há como saber que ficheiros
  // ficaram órfãos no armazenamento.
  const uploadRows = await query(`SELECT storage_key FROM uploads WHERE patient_id=$1 AND tenant_id=$2`, [
    patientId,
    tenantId,
  ]);
  const storageKeys = uploadRows.map((r) => String(r.storage_key)).filter(Boolean);

  for (const rule of PATIENT_TABLE_RULES) {
    if (rule.disposition !== 'delete') continue;
    const rows = rule.tenantScoped
      ? await query(`DELETE FROM ${rule.table} WHERE patient_id=$1 AND tenant_id=$2 RETURNING 1`, [patientId, tenantId])
      : await query(`DELETE FROM ${rule.table} WHERE patient_id=$1 RETURNING 1`, [patientId]);
    if (rows.length) deleted[rule.table] = rows.length;
  }

  // As tabelas 'anonymize' guardam o patient_id, não o nome — a identidade vive
  // toda na linha de `patients`, por isso severá-la ali chega. As exceções são
  // as colunas de instantâneo que existem precisamente para sobreviver a um
  // paciente apagado (appointments.patient_name), e essas têm de ser limpas.
  const apptSnapshot = await query(
    `UPDATE appointments SET patient_name='Paciente anonimizado'
     WHERE patient_id=$1 AND tenant_id=$2 AND patient_name IS NOT NULL RETURNING 1`,
    [patientId, tenantId],
  );
  if (apptSnapshot.length) anonymized.appointments = apptSnapshot.length;

  const invoiceSnapshot = await query(
    `UPDATE invoices SET patient_name='Paciente anonimizado'
     WHERE patient_id=$1 AND tenant_id=$2 AND patient_name IS NOT NULL RETURNING 1`,
    [patientId, tenantId],
  );
  if (invoiceSnapshot.length) anonymized.invoices = invoiceSnapshot.length;

  // A âncora. Tudo o que identifica sai; o que é estatística clínica sem valor
  // identificador (contagens de visitas) fica, para os relatórios não mentirem.
  await query(
    `UPDATE patients SET
       name='Paciente anonimizado', dob=NULL, phone=NULL, email=NULL, nif=NULL,
       address=NULL, postal_code=NULL, city=NULL, insurance=NULL,
       custom_fields='{}'::jsonb, comm_prefs='{}'::jsonb, status='anonymized'
     WHERE id=$1 AND tenant_id=$2`,
    [patientId, tenantId],
  );
  anonymized.patients = 1;

  return { anonymized, deleted, storageKeys };
}

/** Usado pelo teste de cobertura — a regra para uma tabela, ou undefined. */
export function ruleFor(table: string) {
  return RULES_BY_TABLE.get(table);
}
