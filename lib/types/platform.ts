// A linha que a consulta de utilização por clínica devolve — lib/platformStats.ts.
//
// Vive aqui, e não junto das páginas que a desenham, porque é o contrato da
// CONSULTA: mudá-la é mudar o SQL, e o sítio onde isso se nota primeiro tem de
// ser o mesmo ficheiro onde o SQL está.
export interface UsageRow {
  id: string;
  name: string;
  city: string;
  status: string;
  created_at: string;
  operatories: number;
  patients: number;
  active_users: number;
  appts_30d: number;
  appts_prev_30d: number;
  last_appointment: string | null;
  agent_runs_7d: number;
}

/**
 * O que a medição de estado do sistema devolve — lib/platformStats.ts.
 *
 * Estava declarado dentro do componente que o desenha. Passou para aqui quando a
 * página passou a chamar a medição diretamente: o tipo é o contrato da consulta,
 * e declará-lo do lado de quem a LÊ deixa o lado de quem a ESCREVE sem ninguém a
 * verificar.
 */
export interface PlatformHealth {
  database: { ok: boolean; latencyMs: number };
  tenantsByStatus: Array<{ status: string; n: number }>;
  jobs24h: { completed: number; failed: number; total: number };
  lastJobRunAt: string | null;
  staleJobs: Array<{ job_name: string; last_at: string }>;
  notInstrumented: string[];
}

/**
 * O consumo da camada de agentes — lib/aiUsage.ts.
 *
 * Os dois painéis que o desenham (custos e modelos) declaravam cada um a sua
 * versão parcial deste objeto. Duas leituras da mesma resposta, nenhuma delas
 * confrontada com o que a consulta devolve mesmo.
 */
export interface AiUsageRow {
  tenant_name: string | null;
  tenant_city: string | null;
  agent?: string;
  model?: string;
  calls: number;
  failed: number;
  unconfigured?: number;
  input_tokens: string;
  output_tokens: string;
  avg_ms?: number | null;
  costEur: number | null;
}

export interface AiUsage {
  days: number;
  configuredModel: string;
  pricePerMTok: Record<string, { input: number; output: number }>;
  byTenant: AiUsageRow[];
  byAgent: AiUsageRow[];
  byDay: Array<{ day: string; calls: number; input_tokens: string; output_tokens: string; costEur: number | null }>;
  byModel: Array<{ model: string; calls: number; last_at: string | null }>;
}
