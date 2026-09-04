// Puro — sem imports de DB, testável como lib/schedulingPrefsCalc.ts.
//
// A política é a fronteira do agente de agenda escrita como dados, e não como
// uma constante em código. O produto tem agentes que decidem sozinhos (a
// reposição de stock escreve o rascunho de encomenda) e agentes que só preparam
// (o Lead nunca envia), mas essa linha estava sempre desenhada por quem escreveu
// o ficheiro. Aqui não pode ser: contactar doentes é um ato da clínica, com
// consequências para a clínica, e quem assina por isso é o admin dela.
//
// Por isso o valor por omissão é 'propose' — exatamente o que o produto fazia
// antes de existir Dynamic Scheduling. Uma clínica que atualize e não configure
// nada não passa a mandar SMS sozinha; tem de ir lá e dizer que sim.

export type SchedulingMode = 'off' | 'propose' | 'contact' | 'autobook';

export const SCHEDULING_MODES: SchedulingMode[] = ['off', 'propose', 'contact', 'autobook'];

export const MODE_LABEL_PT: Record<SchedulingMode, string> = {
  off: 'Desligado',
  propose: 'Só propor',
  contact: 'Contactar',
  autobook: 'Contactar e marcar',
};

export const MODE_HELP_PT: Record<SchedulingMode, string> = {
  off: 'O agente não calcula nem contacta ninguém.',
  propose: 'O agente calcula quem encaixa em cada espaço livre e mostra a lista. Ninguém é contactado.',
  contact: 'O agente contacta por SMS quem escolheu. A marcação continua a passar por uma pessoa.',
  autobook: 'Um "SIM" do doente marca a consulta sozinho, dentro dos limites abaixo.',
};

export interface SchedulingPolicy {
  mode: SchedulingMode;
  maxOffersPerSlot: number;
  dailyContactCap: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  minScore: number;
  allowedSources: string[];
  horizonDays: number;
  offerExpiryHours: number;
  patientCooldownDays: number;
}

// Espelha os DEFAULT da migração 046. Existe em duplicado de propósito: uma
// clínica sem linha na tabela é o caso normal (ninguém tem de configurar nada
// para o produto funcionar), e esse caso não pode depender de uma query.
export const DEFAULT_POLICY: SchedulingPolicy = {
  mode: 'propose',
  maxOffersPerSlot: 3,
  dailyContactCap: 30,
  quietHoursStart: 21,
  quietHoursEnd: 9,
  minScore: 45,
  allowedSources: ['waitlist', 'treatment_open', 'recall_due', 'advance'],
  horizonDays: 14,
  offerExpiryHours: 24,
  patientCooldownDays: 7,
};

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Normaliza uma linha crua de `tenant_scheduling_policy` (ou a ausência dela)
 * para a política efetiva. Cada campo é limitado ao mesmo intervalo que o CHECK
 * da migração: a base de dados protege-se sozinha, mas isto também corre sobre
 * dados que ainda não passaram por lá (o corpo de um PUT antes de ser gravado),
 * e um limite aplicado num sítio só é um limite que se esquece no outro.
 */
export function normalizePolicy(row: Record<string, unknown> | null | undefined): SchedulingPolicy {
  if (!row) return { ...DEFAULT_POLICY };
  const mode = String(row.mode ?? row.modo ?? '') as SchedulingMode;
  const sources = Array.isArray(row.allowed_sources)
    ? (row.allowed_sources as unknown[]).map(String)
    : Array.isArray(row.allowedSources)
      ? (row.allowedSources as unknown[]).map(String)
      : null;
  return {
    mode: SCHEDULING_MODES.includes(mode) ? mode : DEFAULT_POLICY.mode,
    maxOffersPerSlot: clampInt(row.max_offers_per_slot ?? row.maxOffersPerSlot, 1, 10, DEFAULT_POLICY.maxOffersPerSlot),
    dailyContactCap: clampInt(row.daily_contact_cap ?? row.dailyContactCap, 0, 1000, DEFAULT_POLICY.dailyContactCap),
    quietHoursStart: clampInt(row.quiet_hours_start ?? row.quietHoursStart, 0, 23, DEFAULT_POLICY.quietHoursStart),
    quietHoursEnd: clampInt(row.quiet_hours_end ?? row.quietHoursEnd, 0, 23, DEFAULT_POLICY.quietHoursEnd),
    minScore: clampInt(row.min_score ?? row.minScore, 0, 100, DEFAULT_POLICY.minScore),
    // Uma lista vazia é uma escolha legítima ("não quero nenhuma fonte") e não
    // se confunde com ausência de campo, que cai no default.
    allowedSources: sources ? [...new Set(sources)] : [...DEFAULT_POLICY.allowedSources],
    horizonDays: clampInt(row.horizon_days ?? row.horizonDays, 1, 60, DEFAULT_POLICY.horizonDays),
    offerExpiryHours: clampInt(row.offer_expiry_hours ?? row.offerExpiryHours, 1, 168, DEFAULT_POLICY.offerExpiryHours),
    patientCooldownDays: clampInt(
      row.patient_cooldown_days ?? row.patientCooldownDays,
      0,
      90,
      DEFAULT_POLICY.patientCooldownDays,
    ),
  };
}

/** O agente chega a calcular alguma coisa? */
export function policyComputes(policy: SchedulingPolicy): boolean {
  return policy.mode !== 'off';
}

/** O agente pode contactar doentes sozinho? */
export function policyContacts(policy: SchedulingPolicy): boolean {
  return policy.mode === 'contact' || policy.mode === 'autobook';
}

/** Um "SIM" do doente marca a consulta sem passar por uma pessoa? */
export function policyAutoBooks(policy: SchedulingPolicy): boolean {
  return policy.mode === 'autobook';
}

/**
 * Horas de silêncio, com a volta ao dia tratada: 21→9 significa "das 21 às 9 do
 * dia seguinte", que é o caso normal e o que uma comparação simples `h >= start
 * && h < end` daria sempre como falso.
 *
 * start === end significa silêncio nenhum (e não 24h de silêncio): um intervalo
 * degenerado é quase de certeza um engano de quem configurou, e a leitura que
 * não cala o produto todo é a segura.
 */
export function isQuietHour(hour: number, start: number, end: number): boolean {
  const h = ((Math.round(hour) % 24) + 24) % 24;
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

export function policyIsQuietAt(policy: SchedulingPolicy, date: Date): boolean {
  return isQuietHour(date.getHours(), policy.quietHoursStart, policy.quietHoursEnd);
}

/**
 * Quando é que uma oferta caduca. Nunca depois do próprio horário oferecido:
 * uma vaga para amanhã às 9h com validade de 24h estaria "à espera de resposta"
 * já depois de a cadeira ter ficado vazia à mesma. Devolve null quando o
 * horário já passou — quem chama não deve sequer oferecer.
 */
export function offerExpiryAt(
  policy: SchedulingPolicy,
  slotStart: Date,
  now: Date = new Date(),
): { expiresAt: Date; hours: number } | null {
  const msUntilSlot = slotStart.getTime() - now.getTime();
  if (msUntilSlot <= 0) return null;
  const policyMs = policy.offerExpiryHours * 3600_000;
  const ms = Math.min(policyMs, msUntilSlot);
  return { expiresAt: new Date(now.getTime() + ms), hours: ms / 3600_000 };
}
