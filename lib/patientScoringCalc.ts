// Puro — sem imports de DB, testável como lib/noShowRisk.ts, cujo molde este ficheiro
// segue deliberadamente: pesos declarados, fatores normalizados a 0-1, contribuições
// devolvidas ao lado do número. Não é aprendizagem automática (o projeto não tem
// infraestrutura de treino nem dados rotulados) — é uma pontuação determinística e
// explicável, que é o que uma clínica pode discutir, corrigir e confiar.
//
// ─── Porque é que estes três existem ─────────────────────────────────────────
// lib/lifecycleCalc.ts classifica um doente em quatro etapas e chama-lhe 'inactive'
// aos 6 meses. Isso é um alarme que toca tarde e de uma vez só: no dia 179 o doente
// está "bem" e no dia 180 está "desaparecido", quando na verdade a deriva começou
// muito antes — faltou duas vezes, deixou um plano por responder, parou de atender.
// Esse modelo binário MANTÉM-SE tal como está, porque é ele que governa a reativação
// automática (queueLifecycleOutreach em lib/jobsRunner.ts) e a tabela persistida
// patient_lifecycle_state, e transformar um estado discreto num número contínuo
// partiria as duas coisas. Isto vive ao lado, contínuo, e serve para PRIORIZAR:
// quem contactar primeiro, e com que argumento.
//
// Os três respondem a perguntas diferentes e não devem ser confundidos:
//
//   engagement          — "quão presente é este doente?"  (o que ele já fez)
//   churnRisk           — "estou a perdê-lo?"             (para onde vai)
//   bookingPropensity   — "se eu ligar hoje, ele marca?"  (o que acontece a seguir)
//
// Um doente pode ter engagement alto E churn risk alto ao mesmo tempo: era ótimo
// e está a desaparecer. É precisamente esse o doente que vale a pena telefonar, e
// é exatamente esse que um estado binário só encontra seis meses tarde demais.

export function clamp01(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Rampa linear 0 -> 1 entre `from` e `to` meses. Usada em vez de um degrau para que
// o sinal cresça com a ausência em vez de aparecer todo de uma vez — que é a queixa
// concreta contra o limiar dos 6 meses.
export function monthsRamp(months: unknown, from: number, to: number) {
  const m = Number(months);
  if (!Number.isFinite(m)) return 0;
  if (to <= from) return m >= to ? 1 : 0;
  return clamp01((m - from) / (to - from));
}

// Decaimento suave da "frescura" de uma visita: 1 no próprio dia, 0 ao fim de
// `halfLifeMonths * 4` meses. Exponencial e não linear porque a diferença entre 1 e
// 2 meses sem vir importa muito mais do que entre 25 e 26.
export function recencyScore(monthsSince: unknown, halfLifeMonths = 4) {
  const m = Math.max(0, Number(monthsSince) || 0);
  return clamp01(2 ** (-m / halfLifeMonths));
}

// Uma taxa observada só vale o que valem as observações que a produziram. Com 2
// consultas, uma falta dá 50% de taxa de falta — um número verdadeiro e inútil. Isto
// puxa taxas de amostra pequena para a base `prior` (a média da clínica, ou 0.5 na
// falta dela), com o peso a passar para a observação à medida que `n` cresce.
// É o equivalente honesto de "ainda não sabemos".
export function smoothedRate(successes: unknown, total: unknown, prior: number, priorWeight = 5) {
  const s = Math.max(0, Number(successes) || 0);
  const n = Math.max(0, Number(total) || 0);
  const p = clamp01(prior);
  return clamp01((s + p * priorWeight) / (n + priorWeight));
}

export type ScoreBand = 'baixo' | 'medio' | 'alto';

// Três bandas, com os mesmos cortes para os três scores, para que a UI possa usar as
// mesmas cores em todo o lado. 60 é o mesmo limiar do RISK_OUTREACH_THRESHOLD de
// lib/jobsRunner.ts — de propósito: "alto" quer dizer a mesma coisa em toda a
// aplicação, e não um número por ficheiro.
export const SCORE_BANDS = { medium: 35, high: 60 } as const;

export function scoreBand(score: unknown): ScoreBand {
  const n = Number(score) || 0;
  if (n >= SCORE_BANDS.high) return 'alto';
  if (n >= SCORE_BANDS.medium) return 'medio';
  return 'baixo';
}

// Devolve o score inteiro 0-100 e a contribuição ponderada de cada fator, para a UI
// poder explicar PORQUÊ — nunca um número nu. Idêntico ao contrato de riskScore().
function weightedScore<K extends string>(weights: Record<K, number>, factors: Record<K, number>) {
  const contributions = Object.fromEntries(
    (Object.keys(weights) as K[]).map((k) => [k, clamp01(factors[k]) * weights[k]]),
  ) as Record<K, number>;
  const raw = Object.values<number>(contributions).reduce((a, b) => a + b, 0);
  return { score: Math.round(clamp01(raw) * 100), factors, contributions };
}

// Ordena as contribuições e devolve as que mais pesaram — o "sobretudo X e Y" que
// lib/anomalyCalc.ts já faz para as anomalias, aqui aplicado a um doente. Só entram
// contribuições com peso real (>= 2 pontos em 100), para a explicação não se encher
// de ruído irrelevante.
export function topDrivers<K extends string>(
  contributions: Record<K, number>,
  labels: Record<K, string>,
  limit = 3,
): Array<{ key: K; label: string; points: number }> {
  return (Object.keys(contributions) as K[])
    .map((k) => ({ key: k, label: labels[k], points: Math.round(contributions[k] * 100) }))
    .filter((d) => d.points >= 2)
    .sort((a, b) => (b.points !== a.points ? b.points - a.points : a.key < b.key ? -1 : 1))
    .slice(0, limit);
}

// ─── 1. Engagement ───────────────────────────────────────────────────────────
// Quanto é que este doente participa na relação com a clínica. Tudo aqui é
// comportamento OBSERVADO e passado — nada de intenções nem de previsões.
//
// A presença (comparecer ao que marcou) vale mais do que tudo o resto somado, porque
// é o único sinal que custa alguma coisa ao doente. Responder a um SMS é barato;
// aparecer às 8h30 numa terça-feira não é.
export const ENGAGEMENT_WEIGHTS = {
  attendance: 0.3, // taxa de comparência (suavizada) — apareceu ao que marcou
  recency: 0.2, // há quanto tempo veio pela última vez
  outreachResponse: 0.15, // respondeu/marcou depois de ser contactado
  planAcceptance: 0.15, // aceitou planos que lhe foram apresentados
  paperwork: 0.1, // dados, consentimentos e documentos em dia
  payment: 0.1, // sem saldo em dívida vencido
} as const;

export const ENGAGEMENT_LABELS: Record<keyof typeof ENGAGEMENT_WEIGHTS, string> = {
  attendance: 'Comparência',
  recency: 'Visitou recentemente',
  outreachResponse: 'Responde ao contacto',
  planAcceptance: 'Aceita planos propostos',
  paperwork: 'Documentação em dia',
  payment: 'Pagamentos em dia',
};

export interface EngagementInputs {
  attendedCount?: number;
  scheduledCount?: number; // comparecidas + faltas + cancelamentos
  monthsSinceLastVisit?: number;
  outreachResponded?: number;
  outreachSent?: number;
  plansAccepted?: number;
  plansPresented?: number;
  paperworkComplete?: boolean; // sem campos obrigatórios em falta nem consentimentos por assinar
  hasOverdueBalance?: boolean;
  // Médias da clínica, para a suavização de amostra pequena. Sem elas assume-se 0.5,
  // que é o "não sei" honesto.
  clinicAttendanceRate?: number;
  clinicResponseRate?: number;
  clinicAcceptanceRate?: number;
}

export function engagementScore(inputs: EngagementInputs) {
  const factors = {
    attendance: smoothedRate(inputs.attendedCount, inputs.scheduledCount, inputs.clinicAttendanceRate ?? 0.5),
    recency: recencyScore(inputs.monthsSinceLastVisit),
    outreachResponse: smoothedRate(inputs.outreachResponded, inputs.outreachSent, inputs.clinicResponseRate ?? 0.5, 3),
    planAcceptance: smoothedRate(inputs.plansAccepted, inputs.plansPresented, inputs.clinicAcceptanceRate ?? 0.5, 2),
    paperwork: inputs.paperworkComplete ? 1 : 0,
    payment: inputs.hasOverdueBalance ? 0 : 1,
  };
  return weightedScore(ENGAGEMENT_WEIGHTS, factors);
}

// ─── 2. Risco de abandono (contínuo) ─────────────────────────────────────────
// O substituto do degrau dos 6 meses. Sobe com a ausência, com as faltas, com os
// tratamentos deixados a meio e com o silêncio — e desce quando há uma consulta
// marcada, que é a prova mais forte de que o doente não se foi embora.
//
// A rampa da ausência começa aos 3 meses e satura aos 18: aos 3 já é sinal (o recall
// típico é a 6), aos 18 já não interessa distinguir entre "muito longe" e "ainda mais
// longe". O corte binário antigo, aos 6, cai a meio desta rampa — quem estava a ser
// apanhado continua a ser, agora com meses de antecedência.
//
// O engagement NÃO entra aqui, e isso foi uma decisão, não um esquecimento. A versão
// anterior deste ficheiro tinha um fator `disengagement` (1 − engagement) com peso
// 0.1, e ele fazia exatamente o contrário do que o módulo existe para fazer: um
// doente historicamente exemplar que desaparece há dez meses via o risco dele ser
// PUXADO PARA BAIXO pelo seu próprio bom historial, e caía atrás de um doente que
// nunca prestou. Era também duplicação — a recência já pesa no engagement e a
// ausência já pesa aqui, a medir a mesma coisa duas vezes. Os dois scores são hoje
// independentes por construção, que é o que permite o cruzamento útil ("era ótimo e
// está a ir-se embora") em vez de o suprimir. O teste
// "outreachPriority põe o recuperável à frente do perdido" tranca isto.
export const CHURN_WEIGHTS = {
  absence: 0.35, // meses sem vir
  recallOverdue: 0.2, // recall vencido e sem resposta
  noShow: 0.15, // taxa de faltas (suavizada)
  abandonedTreatment: 0.15, // tratamento aceite e nunca concluído
  silence: 0.15, // contactos seguidos sem qualquer resposta
} as const;

export const CHURN_LABELS: Record<keyof typeof CHURN_WEIGHTS, string> = {
  absence: 'Meses sem vir',
  recallOverdue: 'Recall vencido',
  noShow: 'Histórico de faltas',
  abandonedTreatment: 'Tratamento a meio',
  silence: 'Não responde aos contactos',
};

export const CHURN_ABSENCE_RAMP = { from: 3, to: 18 } as const;
// Uma consulta futura marcada não é "menos um sinal de risco" — é a refutação da
// própria pergunta. Por isso não é um peso negativo entre outros: é um amortecedor
// aplicado ao total, que corta o score para um quinto. Não o anula, porque um doente
// com histórico de faltas e uma consulta marcada continua a ser um doente em risco.
export const CHURN_FUTURE_APPOINTMENT_DAMPENER = 0.2;

export interface ChurnInputs {
  monthsSinceLastVisit?: number;
  recallOverdueMonths?: number;
  noShowCount?: number;
  scheduledCount?: number;
  hasAbandonedTreatment?: boolean;
  consecutiveUnansweredOutreach?: number;
  hasFutureAppointment?: boolean;
  clinicNoShowRate?: number;
}

export function churnRiskScore(inputs: ChurnInputs) {
  const factors = {
    absence: monthsRamp(inputs.monthsSinceLastVisit, CHURN_ABSENCE_RAMP.from, CHURN_ABSENCE_RAMP.to),
    recallOverdue: monthsRamp(inputs.recallOverdueMonths, 0, 6),
    noShow: smoothedRate(inputs.noShowCount, inputs.scheduledCount, inputs.clinicNoShowRate ?? 0.1),
    abandonedTreatment: inputs.hasAbandonedTreatment ? 1 : 0,
    // Três contactos seguidos sem resposta é o ponto em que "esteve ocupado" deixa
    // de ser a explicação mais provável.
    silence: clamp01((Number(inputs.consecutiveUnansweredOutreach) || 0) / 3),
  };
  const base = weightedScore(CHURN_WEIGHTS, factors);
  if (!inputs.hasFutureAppointment) return base;
  return {
    ...base,
    score: Math.round(base.score * CHURN_FUTURE_APPOINTMENT_DAMPENER),
    dampened: true as const,
  };
}

// ─── 3. Probabilidade de marcação ────────────────────────────────────────────
// "Se eu contactar esta pessoa hoje, ela marca?" É o score que ordena uma lista de
// chamadas: dado tempo para vinte telefonemas, quais vinte.
//
// Distingue-se dos outros dois por incluir MOTIVO e não só disposição. Um doente
// exemplar sem nada pendente não tem razão nenhuma para marcar; um doente mediano com
// um plano de 3 000 € por responder e um recall vencido tem duas.
export const BOOKING_WEIGHTS = {
  engagement: 0.25, // disposição geral
  pendingReason: 0.3, // tem motivo concreto: plano por responder, recall vencido, tratamento a meio
  historicalConversion: 0.2, // já marcou depois de ser contactado antes
  reachability: 0.15, // contactável: telefone válido e sem opt-out
  freshness: 0.1, // não desapareceu há tanto tempo que já mudou de clínica
} as const;

export const BOOKING_LABELS: Record<keyof typeof BOOKING_WEIGHTS, string> = {
  engagement: 'Envolvimento',
  pendingReason: 'Tem motivo pendente',
  historicalConversion: 'Já marcou após contacto',
  reachability: 'Contactável',
  freshness: 'Ausência ainda recuperável',
};

export interface BookingPropensityInputs {
  engagement?: number; // 0-100
  hasOpenPlan?: boolean;
  recallDue?: boolean;
  hasAbandonedTreatment?: boolean;
  bookingsAfterOutreach?: number;
  outreachSent?: number;
  hasValidPhone?: boolean;
  optedOut?: boolean; // comm_prefs.doNotContact (ver lib/commPrefs.ts)
  monthsSinceLastVisit?: number;
  hasFutureAppointment?: boolean;
  clinicOutreachConversionRate?: number;
}

// Tipo de retorno explícito: as duas saídas (suprimida e calculada) têm de ter a mesma
// forma, senão quem chama tem de estreitar uma união antes de poder ler `suppressed` —
// e o campo existe precisamente para ser lido sem cerimónia.
export interface BookingPropensityResult {
  score: number;
  factors: Record<keyof typeof BOOKING_WEIGHTS, number>;
  contributions: Record<keyof typeof BOOKING_WEIGHTS, number>;
  // Presente só quando o score é 0 por impossibilidade e não por baixa probabilidade.
  suppressed?: string;
}

export function bookingPropensityScore(inputs: BookingPropensityInputs): BookingPropensityResult {
  // Duas condições que não são "menos um ponto" — são zero, porque tornam a pergunta
  // impossível de responder afirmativamente. Sem telefone válido ou com opt-out
  // explícito não há contacto a fazer; com consulta já marcada não há nada a marcar.
  // Devolver 0 e dizer porquê é mais honesto do que devolver um número baixo que
  // alguém acabaria por interpretar como "vale a pena tentar".
  if (inputs.optedOut || inputs.hasValidPhone === false || inputs.hasFutureAppointment) {
    const zero = Object.fromEntries(Object.keys(BOOKING_WEIGHTS).map((k) => [k, 0])) as Record<
      keyof typeof BOOKING_WEIGHTS,
      number
    >;
    return {
      score: 0,
      factors: zero,
      contributions: zero,
      suppressed: inputs.hasFutureAppointment
        ? 'já tem consulta marcada'
        : inputs.optedOut
          ? 'não autoriza contacto'
          : 'sem telefone válido',
    };
  }

  // Motivos acumulam com retornos decrescentes: dois motivos são melhores do que um,
  // mas não o dobro — quem tem plano por responder E recall vencido não marca duas
  // consultas por isso.
  const reasons = [inputs.hasOpenPlan, inputs.recallDue, inputs.hasAbandonedTreatment].filter(Boolean).length;
  const factors = {
    engagement: clamp01((Number(inputs.engagement) || 0) / 100),
    pendingReason: reasons === 0 ? 0 : reasons === 1 ? 0.6 : reasons === 2 ? 0.85 : 1,
    historicalConversion: smoothedRate(
      inputs.bookingsAfterOutreach,
      inputs.outreachSent,
      inputs.clinicOutreachConversionRate ?? 0.2,
      3,
    ),
    reachability: 1,
    // Inverso da rampa de ausência: aos 24 meses a probabilidade de a pessoa ainda
    // ser doente desta clínica é já muito baixa, esteja o resto como estiver.
    freshness: 1 - monthsRamp(inputs.monthsSinceLastVisit, 6, 24),
  };
  return weightedScore(BOOKING_WEIGHTS, factors);
}

// ─── O conjunto ──────────────────────────────────────────────────────────────
// Calcula os três de uma vez, com a ligação certa entre eles (engagement alimenta os
// outros dois), para que quem chama não possa enganar-se na ordem.
export interface PatientScoringInputs extends EngagementInputs, ChurnInputs, BookingPropensityInputs {}

export interface PatientScores {
  engagement: { score: number; band: ScoreBand; drivers: Array<{ key: string; label: string; points: number }> };
  churnRisk: { score: number; band: ScoreBand; drivers: Array<{ key: string; label: string; points: number }> };
  bookingPropensity: {
    score: number;
    band: ScoreBand;
    drivers: Array<{ key: string; label: string; points: number }>;
    suppressed?: string;
  };
}

export function scorePatient(inputs: PatientScoringInputs): PatientScores {
  const engagement = engagementScore(inputs);
  const churn = churnRiskScore(inputs);
  const booking = bookingPropensityScore({ ...inputs, engagement: engagement.score });
  return {
    engagement: {
      score: engagement.score,
      band: scoreBand(engagement.score),
      drivers: topDrivers(engagement.contributions, ENGAGEMENT_LABELS),
    },
    churnRisk: {
      score: churn.score,
      band: scoreBand(churn.score),
      drivers: topDrivers(churn.contributions, CHURN_LABELS),
    },
    bookingPropensity: {
      score: booking.score,
      band: scoreBand(booking.score),
      drivers: topDrivers(booking.contributions, BOOKING_LABELS),
      ...(booking.suppressed ? { suppressed: booking.suppressed } : {}),
    },
  };
}

// A lista de chamadas: quem contactar primeiro. Não é ordenar por risco de abandono —
// isso põe no topo os casos perdidos, que é exatamente onde o tempo se desperdiça. É
// ordenar pelo produto de "estou a perdê-lo" com "consigo trazê-lo de volta", que é a
// definição operacional de uma chamada que vale a pena fazer.
export function outreachPriority(scores: PatientScores): number {
  return Math.round((scores.churnRisk.score * scores.bookingPropensity.score) / 100);
}
