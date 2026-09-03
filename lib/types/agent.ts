import type { JobName } from '@/lib/jobsRunner';

// 'revenue' existiu como agente à parte e foi absorvido em 'patient'/'finance' — ver
// o cabeçalho de lib/agents/registry.ts. 'compliance' não estava no roadmap de fases
// mas continua a existir: o RGPD não desaparece por não constar de uma lista.
export type AgentId =
  | 'lead'
  | 'patient'
  | 'scheduling'
  | 'finance'
  | 'operations'
  | 'management'
  | 'group'
  | 'compliance';

// Estado da ligação à IA, por agente. Todos os sete do roadmap têm agora um modelo a
// decidir alguma coisa (lib/agents/*Agent.ts, um ficheiro por agente); 'compliance'
// continua determinístico de propósito — apagar dados por decisão de um modelo é
// exatamente o que a fronteira desse agente proíbe. A página mostra isto tal como
// está, em vez de sugerir capacidade que não existe.
export type AgentAiState = 'none' | 'partial' | 'wired';

export interface AgentDefinition {
  id: AgentId;
  name: string;
  icon: string;
  /** O que o agente decide. Uma frase, mostrada no cartão. */
  summary: string;
  /** Onde fica a fronteira com os agentes vizinhos — o que este NÃO faz. */
  boundary: string;
  /** Tarefas de lib/jobsRunner.ts que este agente já governa hoje. */
  jobs: readonly Exclude<JobName, 'all'>[];
  /** Módulos de lib/ de onde lê os factos já apurados. */
  reads: readonly string[];
  ai: AgentAiState;
}

/** Uma execução de job_runs, já reduzida ao que o cartão mostra. */
export interface AgentJobRun {
  jobName: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  details: Record<string, unknown>;
}

export interface AgentStatus extends AgentDefinition {
  lastRun: AgentJobRun | null;
}

/** Uma conclusão escrita por um agente de análise (agent_insights, migração 041). */
export interface AgentInsight {
  id: string;
  tenant_id: string | null;
  agent_id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  impact_eur: string | number | null;
  resolved_at: string | null;
  created_at: string;
}
