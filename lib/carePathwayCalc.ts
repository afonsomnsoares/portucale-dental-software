// Puro — sem imports de DB, testável como lib/checklistCalc.ts e lib/taskRoutingCalc.ts.
//
// ─── O que faltava ──────────────────────────────────────────────────────────
// As peças do encadeamento pré e pós-consulta existem todas há muito: tarefas
// (patient_tasks), checklists (checklist_templates), consentimentos (consent_forms),
// documentos (document_templates), dados em falta (lib/missingData.ts), recalls. O que
// não existia era a SEQUÊNCIA — nada se dispara a partir do tipo de consulta. Uma
// clínica que marca um implante para quinta-feira tem de se lembrar, à mão, de gerar o
// consentimento, confirmar o jejum e verificar se o doente tem morada preenchida.
// Lembrar-se à mão é precisamente o que este produto existe para dispensar.
//
// O padrão a seguir já estava escrito noutro sítio: procedure_item_usage (migração 029)
// liga tipo de consulta a material consumido, e é isso que permite prever compras a
// partir da agenda. Isto é a mesma ligação, para trabalho em vez de material —
// care_pathway_steps liga tipo de consulta a passos administrativos.
//
// ─── A regra que torna isto seguro de correr todos os dias ──────────────────
// Um passo não é "criado e marcado como feito". Um passo é DEVIDO enquanto a prova de
// que está satisfeito não existir. O motor pergunta sempre "isto já está?" à realidade
// — o consentimento está assinado? o documento foi gerado? a tarefa está fechada? — em
// vez de guardar um registo paralelo de progresso que se dessincroniza no dia em que
// alguém assina um consentimento pelo caminho normal. É a mesma escolha que fez a etapa
// da jornada (lib/patientJourneyCalc.ts) ser derivada e não guardada.
//
// Consequência prática: o job pode correr de hora a hora sem nunca duplicar nada, e uma
// clínica que faça o trabalho por fora vê os passos desaparecerem sozinhos.

export type PathwayPhase = 'pre' | 'post';

// O que um passo pede que se faça. Cada um destes mapeia para uma capacidade que já
// existe no produto — nenhum deles é uma funcionalidade nova disfarçada de passo.
export type PathwayAction =
  // Uma tarefa em patient_tasks, distribuída por lib/taskRouting.ts.
  | 'task'
  // Um consentimento por procedimento (consent_forms) por preparar e assinar.
  | 'consent'
  // Um documento administrativo gerado a partir de um template (document_templates).
  | 'document'
  // Verificar campos obrigatórios em falta no perfil (lib/missingData.ts).
  | 'missing_data'
  // Um pedido ao doente pelo portal sem login (patient_portal_tokens).
  | 'portal_request'
  // Criar/atualizar o recall que fecha o ciclo depois do tratamento.
  | 'recall';

export const PATHWAY_ACTIONS: readonly PathwayAction[] = [
  'task',
  'consent',
  'document',
  'missing_data',
  'portal_request',
  'recall',
] as const;

export const PATHWAY_ACTION_LABELS: Record<PathwayAction, string> = {
  task: 'Tarefa',
  consent: 'Consentimento',
  document: 'Documento',
  missing_data: 'Dados em falta',
  portal_request: 'Pedido ao doente',
  recall: 'Recall',
};

export interface PathwayStep {
  id: string;
  // Ordem dentro da fase, para a UI e para o desempate. Não é a ordem de execução —
  // vários passos podem estar devidos ao mesmo tempo.
  position: number;
  phase: PathwayPhase;
  action: PathwayAction;
  title: string;
  // Dias relativos à consulta em que o passo passa a estar devido. Negativo antes,
  // positivo depois. Um passo 'pre' com offset -2 fica devido dois dias antes; um
  // passo 'post' com offset 1 fica devido no dia seguinte.
  offsetDays: number;
  // Papéis elegíveis para a tarefa resultante. Vazio = a fila partilhada decide
  // (ver lib/taskRoutingCalc.ts, cujo filtro de papel é estrito e sem fallback).
  roles: string[];
  // Um passo bloqueante é um que, por não estar feito, torna a consulta problemática —
  // um implante sem consentimento assinado. Não impede nada tecnicamente (o software
  // não cancela consultas), mas aparece como alerta e não como tarefa de rotina.
  blocking: boolean;
  // Referência à entidade que satisfaz o passo, quando aplicável: o slug do template de
  // documento, o tipo de consentimento, o tipo de recall.
  reference?: string | null;
}

// O que a realidade já diz sobre esta consulta. É o chamador (lib/carePathway.ts) que
// preenche isto a partir da base de dados; aqui só se compara.
export interface PathwayEvidence {
  // Títulos/marcadores de tarefas abertas OU concluídas para esta consulta. Concluídas
  // contam: um passo feito ontem não volta a ser devido hoje.
  satisfiedStepIds: Set<string>;
  // Consentimentos já assinados para este doente, por tipo.
  signedConsents: Set<string>;
  // Documentos já gerados para esta consulta, por slug de template.
  generatedDocuments: Set<string>;
  // Campos obrigatórios ainda em falta no perfil do doente.
  missingFields: string[];
  // Recalls ativos do doente, por tipo.
  activeRecalls: Set<string>;
}

export interface PathwayContext {
  appointmentId: string;
  patientId: string | null;
  patientName: string;
  apptDate: string; // 'YYYY-MM-DD'
  type: string;
  // Estado da consulta. 'departed' significa realizada; 'no-show' significa que os
  // passos pós-consulta não fazem sentido nenhum.
  status: string;
}

export interface DuePathwayStep {
  step: PathwayStep;
  context: PathwayContext;
  // Data em que o passo passou a estar devido.
  dueDate: string;
  // Chave estável e determinística — é ela que torna o motor idempotente. A mesma
  // consulta e o mesmo passo produzem sempre a mesma chave, por isso o chamador pode
  // usá-la como marcador de deduplicação em patient_tasks.notes, exatamente como
  // lib/jobsRunner.ts já faz para os lembretes de checklist e de manutenção.
  key: string;
  reason: string;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function stepKey(appointmentId: string, stepId: string): string {
  return `pathway:${appointmentId}:${stepId}`;
}

// Um passo pós-consulta só faz sentido depois de a consulta ter acontecido de facto.
// Gerar o "marcar controlo aos 6 meses" para uma consulta a que o doente faltou é
// produzir trabalho a partir de uma coisa que não existiu — e é o tipo de ruído que
// faz uma equipa deixar de olhar para a lista.
const COMPLETED_STATUSES = new Set(['departed']);

export function isPhaseApplicable(phase: PathwayPhase, status: string): boolean {
  if (phase === 'pre') return status !== 'no-show';
  return COMPLETED_STATUSES.has(status);
}

// Um passo está satisfeito quando a prova dele existe. A prova é diferente para cada
// tipo de ação — é esta função que torna o motor idempotente sem guardar estado.
export function isStepSatisfied(step: PathwayStep, evidence: PathwayEvidence, appointmentId: string): boolean {
  if (evidence.satisfiedStepIds.has(stepKey(appointmentId, step.id))) return true;

  switch (step.action) {
    case 'consent':
      return step.reference ? evidence.signedConsents.has(step.reference) : false;
    case 'document':
      return step.reference ? evidence.generatedDocuments.has(step.reference) : false;
    case 'missing_data':
      // Este é o único passo que se satisfaz a si próprio pela ausência do problema:
      // se não falta nada, não há nada a pedir.
      return evidence.missingFields.length === 0;
    case 'recall':
      return step.reference ? evidence.activeRecalls.has(step.reference) : false;
    default:
      // 'task' e 'portal_request' não têm prova própria além da tarefa em si, por isso
      // dependem inteiramente do marcador em satisfiedStepIds.
      return false;
  }
}

// Os passos que estão devidos HOJE para uma consulta: a fase aplica-se, a data já
// chegou, e a prova ainda não existe.
export function dueStepsFor(
  context: PathwayContext,
  steps: PathwayStep[],
  evidence: PathwayEvidence,
  today: string,
): DuePathwayStep[] {
  const due: DuePathwayStep[] = [];

  for (const step of steps) {
    if (!isPhaseApplicable(step.phase, context.status)) continue;
    const dueDate = addDays(context.apptDate, step.offsetDays);
    if (dueDate > today) continue;
    if (isStepSatisfied(step, evidence, context.appointmentId)) continue;

    due.push({
      step,
      context,
      dueDate,
      key: stepKey(context.appointmentId, step.id),
      reason: reasonFor(step, context, evidence),
    });
  }

  // Bloqueantes primeiro, depois por proximidade da consulta, depois pela posição
  // declarada no template. Determinístico, para a mesma agenda produzir sempre a mesma
  // ordem — mesma regra de desempate de lib/taskRoutingCalc.ts.
  return due.sort((a, b) => {
    if (a.step.blocking !== b.step.blocking) return a.step.blocking ? -1 : 1;
    if (a.context.apptDate !== b.context.apptDate) return a.context.apptDate < b.context.apptDate ? -1 : 1;
    if (a.step.position !== b.step.position) return a.step.position - b.step.position;
    return a.step.id < b.step.id ? -1 : 1;
  });
}

// O texto que vai para a tarefa. Escrito aqui e não na rota para as três origens
// possíveis (job, API, pré-visualização do template) dizerem exatamente o mesmo.
function reasonFor(step: PathwayStep, context: PathwayContext, evidence: PathwayEvidence): string {
  const quando = step.phase === 'pre' ? `antes de ${context.apptDate}` : `depois de ${context.apptDate}`;
  if (step.action === 'missing_data' && evidence.missingFields.length) {
    return `${context.patientName} · ${context.type} (${quando}): faltam ${evidence.missingFields.join(', ')}.`;
  }
  if (step.action === 'consent') {
    return `${context.patientName} · ${context.type} (${quando}): consentimento "${step.reference || step.title}" por assinar.`;
  }
  return `${context.patientName} · ${context.type} (${quando}): ${step.title}.`;
}

// ─── Pré-visualização de um percurso ────────────────────────────────────────
// Para o ecrã de configuração: dado um template e uma data de consulta hipotética,
// mostrar o calendário completo. Sem isto ninguém consegue perceber o que é que acabou
// de configurar até a próxima consulta daquele tipo aparecer.
export interface PathwayPreviewEntry {
  step: PathwayStep;
  date: string;
  relative: string;
}

export function previewPathway(steps: PathwayStep[], apptDate: string): PathwayPreviewEntry[] {
  return [...steps]
    .sort((a, b) => (a.offsetDays !== b.offsetDays ? a.offsetDays - b.offsetDays : a.position - b.position))
    .map((step) => ({
      step,
      date: addDays(apptDate, step.offsetDays),
      relative:
        step.offsetDays === 0
          ? 'no próprio dia'
          : step.offsetDays < 0
            ? `${-step.offsetDays} ${-step.offsetDays === 1 ? 'dia' : 'dias'} antes`
            : `${step.offsetDays} ${step.offsetDays === 1 ? 'dia' : 'dias'} depois`,
    }));
}

// ─── Validação de um template ───────────────────────────────────────────────
// Corre antes de gravar. Apanha as três maneiras de configurar um percurso que nunca
// dispara nada — todas silenciosas, todas descobertas semanas depois.
export function validatePathwaySteps(steps: PathwayStep[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const s of steps) {
    if (ids.has(s.id)) errors.push(`Passo duplicado: "${s.id}".`);
    ids.add(s.id);

    if (!s.title.trim()) errors.push(`Passo "${s.id}" sem título.`);

    // Um passo 'pre' com offset positivo fica devido DEPOIS da consulta, quando já não
    // serve para nada. É sempre um lapso de sinal, nunca uma intenção.
    if (s.phase === 'pre' && s.offsetDays > 0) {
      errors.push(`"${s.title}" é um passo pré-consulta com prazo depois da consulta (${s.offsetDays} dias).`);
    }
    if (s.phase === 'post' && s.offsetDays < 0) {
      errors.push(`"${s.title}" é um passo pós-consulta com prazo antes da consulta (${s.offsetDays} dias).`);
    }
    // Sem referência, um passo destes não tem como saber se já está satisfeito, e por
    // isso ficaria devido para sempre.
    if ((s.action === 'consent' || s.action === 'document' || s.action === 'recall') && !s.reference) {
      errors.push(`"${s.title}" é do tipo ${PATHWAY_ACTION_LABELS[s.action]} e precisa de indicar qual.`);
    }
  }

  return errors;
}
