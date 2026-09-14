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

/**
 * A configuração técnica em vigor — lib/platformStats.ts.
 *
 * Duas regras que este tipo existe para impor:
 *
 * 1. `secrets` diz SE está definido, nunca o VALOR. Um ecrã de plataforma que
 *    mostre a chave da Anthropic é uma fuga de credenciais com sessão iniciada.
 *    Por isso o campo chama-se `set` e é booleano — não há aqui sítio onde um
 *    valor caiba, mesmo que alguém queira.
 *
 * 2. `onDisk` é `null` — e não `[]` — quando o processo não consegue ler o
 *    diretório de migrações. A imagem de produção não copia `scripts/` (ver
 *    Dockerfile), por isso este caso é o normal em produção, não a exceção.
 *    «Não sei quais são» é diferente de «não há nenhuma pendente», e as duas
 *    respostas levam a decisões opostas.
 */
export interface SystemConfigInfo {
  runtime: {
    appVersion: string | null;
    commit: string | null;
    node: string;
    env: string;
  };
  migrations: {
    /** Ids gravados em schema_migrations (o nome do ficheiro, com .sql). */
    applied: string[];
    /** Ficheiros em scripts/migrations, ou null se não forem legíveis aqui. */
    onDisk: string[] | null;
    /** Em disco e por aplicar. Vazio quando onDisk é null — ver acima. */
    pending: string[];
    /** Aplicadas na base e sem ficheiro correspondente: a base está à frente do código. */
    drift: string[];
  };
  secrets: Array<{ key: string; group: string; set: boolean; note: string }>;
}
