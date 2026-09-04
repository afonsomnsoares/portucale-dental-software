import type { AgentDefinition, AgentId } from '@/lib/types/agent';

// O catálogo dos agentes. É deliberadamente só dados: nenhuma chamada à base de
// dados, nenhuma chamada à IA — por isso testa-se sem Postgres
// (test/agentsRegistry.test.ts) e serve tanto à API como à página.
//
// Cada agente declara as tarefas de lib/jobsRunner.ts que já governa hoje. Isso é o
// ponto importante: nenhum destes agentes é novo trabalho a inventar — são jobs
// determinísticos que já correm, agrupados por quem decide o quê. O campo `ai`
// diz onde é que um modelo entra: 'operations' já decide sozinha a tarefa
// 'reorderSuggestions' (lib/agents/reorderAgent.ts) e 'lead' já qualifica e escreve
// o rascunho de resposta (lib/agents/leadAgent.ts, nunca envia sozinho — ver
// boundary abaixo). Os restantes continuam 'none' até serem construídos com o
// mesmo cuidado de fronteiras.
//
// Taxonomia alinhada ao roadmap de fases do produto (Fase 1: Agenda/Doente/Lead,
// Fase 2: Finanças/Operações). Existia antes um agente 'revenue' à parte
// ("Receita") que hoje está absorvido aqui: as tarefas de pré-fatura
// (planFollowup, recallOutreach, lifecycleOutreach) são claramente jornada do
// doente, por isso ficam em 'patient'; 'recovery' (saldo em dívida) é dinheiro,
// por isso fica em 'finance'.
//
// Houve aqui dois agentes de análise — 'Gestão' (comparava períodos) e 'Grupo'
// (comparava clínicas entre si) — removidos com o módulo de Relatórios de que
// dependiam (liam lib/reports.ts). Este catálogo passou a ter só agentes que
// agem sobre o trabalho da clínica, não que o comentam.
export const AGENTS: readonly AgentDefinition[] = [
  {
    id: 'lead',
    name: 'Lead',
    icon: '📞',
    summary:
      'Do primeiro contacto até virar paciente: qualifica a intenção e escreve o rascunho da resposta. Nunca envia sozinho.',
    boundary:
      'Qualifica e prepara — o envio da resposta a alguém de fora da clínica exige sempre uma pessoa a clicar (ver app/api/leads/[id]/send-reply/route.ts). Depois de convertido, o assunto passa a ser do Doente.',
    jobs: ['leadTriage', 'leadFollowup', 'leadSourceReview'],
    reads: ['lib/agents/leadAgent.ts', 'lib/agents/leadAgentCalc.ts'],
    ai: 'wired',
  },
  {
    id: 'patient',
    name: 'Doente',
    icon: '👤',
    summary: 'O contexto de cada doente e qual é a próxima ação: planos por aceitar, recall e reativação.',
    boundary: 'Coordena; não pratica atos clínicos nem decide tratamento. Antes de virar paciente, é do Lead.',
    jobs: ['assignTasks', 'planFollowup', 'recallOutreach', 'lifecycleOutreach', 'patientReview'],
    reads: [
      'lib/nextAction.ts',
      'lib/patientJourney.ts',
      'lib/missingData.ts',
      'lib/taskRouting.ts',
      'lib/lifecycle.ts',
      'lib/agents/patientAgent.ts',
    ],
    ai: 'wired',
  },
  {
    id: 'scheduling',
    name: 'Agenda',
    icon: '📅',
    summary:
      'Decide a utilização da capacidade: procura os espaços vazios, escolhe de toda a base quem os deve ocupar e oferece-os.',
    boundary:
      'Agenda de doentes; turnos e férias do pessoal são de Operações. Até onde contacta e se marca sozinho não é decidido aqui — é a política que a clínica assina (tenant_scheduling_policy, migração 046). Por omissão calcula e mostra, sem contactar ninguém. Nunca desmarca uma consulta que já existe: propõe (ver lib/scheduleOptimizer.ts).',
    jobs: ['reminders', 'risk', 'riskOutreach', 'waitlistExpire', 'dynamicScheduling', 'scheduleReview'],
    reads: [
      'lib/dynamicScheduling.ts',
      'lib/demandPool.ts',
      'lib/demandPoolCalc.ts',
      'lib/agendaOpenings.ts',
      'lib/scheduleOptimizer.ts',
      'lib/waitlistMatch.ts',
      'lib/noShowRisk.ts',
      'lib/schedulingPolicyCalc.ts',
      'lib/agents/schedulingAgent.ts',
      'lib/agents/dynamicSchedulingAgent.ts',
    ],
    ai: 'wired',
  },
  {
    id: 'finance',
    name: 'Finanças',
    icon: '💳',
    summary: 'Dinheiro já faturado: cobrança, valores pendentes, saldo em dívida e indicadores do período.',
    boundary: 'Antes da fatura existir, o assunto é do Doente/Lead.',
    jobs: ['summary', 'recovery', 'financeReview'],
    reads: ['lib/recovery.ts', 'lib/agents/financeAgent.ts'],
    ai: 'wired',
  },
  {
    id: 'operations',
    name: 'Operações',
    icon: '⚙️',
    summary:
      'A clínica a funcionar: checklists, incidentes, passagem de turno, stock, reposição e manutenção de equipamento. A reposição já é decidida por IA.',
    boundary:
      'Coordena a casa e a equipa; não fala com doentes. A IA decide o rascunho de encomenda sozinha, mas nunca sai de "draft" — avançar para o fornecedor continua a exigir uma pessoa.',
    jobs: ['escalateIncidents', 'checklistReminders', 'handoffReminders', 'reorderSuggestions', 'equipmentMaintenance'],
    reads: [
      'lib/shiftHandoff.ts',
      'lib/inventoryCalc.ts',
      'lib/staffAvailabilityCalc.ts',
      'lib/agents/reorderAgent.ts',
      'lib/equipment.ts',
    ],
    ai: 'wired',
  },
  {
    id: 'compliance',
    name: 'Conformidade',
    icon: '🔐',
    summary: 'RGPD, retenção e auditoria: deteta prazos vencidos e prepara pedidos do titular.',
    boundary: 'Prepara e sinaliza — nunca apaga. O apagamento é irreversível e assina-o uma pessoa.',
    jobs: ['retention', 'retentionPolicies'],
    reads: ['lib/dataSubject.ts', 'lib/retention.ts', 'lib/audit.ts'],
    ai: 'none',
  },
] as const;

// A comunicação não é um agente — é o canal por onde todos passam, e por isso a
// política vive num sítio só: consentimento, canal preferido, limite por semana,
// horas de silêncio e deduplicação entre agentes. O job 'send' é a saída de todos.
export const COMMS_JOB = 'send' as const;

export function agentById(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}

/** Todas as tarefas governadas por agentes, sem o canal de saída partilhado. */
export function agentJobNames(): string[] {
  return AGENTS.flatMap((a) => [...a.jobs]);
}

export function agentForJob(job: string): AgentId | null {
  return AGENTS.find((a) => (a.jobs as readonly string[]).includes(job))?.id ?? null;
}
