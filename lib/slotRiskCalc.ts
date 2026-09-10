// Puro — sem imports de DB, testável como lib/noShowRisk.ts e lib/scheduleOptimizerCalc.ts.
//
// ─── O que isto responde, e porque é que ainda não existia ───────────────────
// lib/forecast.ts já projeta cancelamentos, faltas e capacidade livre — mas AO NÍVEL
// DA CLÍNICA e do dia: "na próxima semana esperam-se 4 faltas". Isso chega para
// planear pessoal e não chega para nada mais: ninguém pode contactar a lista de
// espera para "4 faltas".
//
// Isto desce ao slot. Para cada consulta já marcada, qual é a probabilidade de
// AQUELE lugar, naquela cadeira, àquela hora, acabar vazio — e, quando isso
// acontecer, se ainda haverá tempo de o encher.
//
// ─── A distinção que faz o módulo ───────────────────────────────────────────
// Um lugar pode esvaziar-se de duas maneiras que não têm nada a ver uma com a outra:
//
//   • FALTA (no-show)      — o doente não aparece. Descobre-se à hora. É tempo
//                            perdido, ponto final.
//   • CANCELAMENTO         — o doente avisa. Descobre-se com dias de antecedência.
//                            É tempo RECUPERÁVEL, se houver a quem oferecê-lo.
//
// Somar as duas coisas num único "risco" é o erro que este ficheiro existe para não
// cometer: uma clínica com muitos cancelamentos antecipados e uma lista de espera
// cheia não tem problema nenhum, e uma clínica com metade das faltas mas nenhuma
// lista de espera tem. O que interessa prever não é "vai esvaziar-se" — é
// "vai FICAR vazio".
//
//   P(fica vazio) = P(esvazia) × [ P(é falta) + P(é cancelamento) × P(não se enche) ]
//
// O primeiro termo vem de appointments.risk_score, que lib/noShowRisk.ts já calcula e
// lib/scheduleIntel.ts já persiste — não é recalculado aqui, para não haver duas
// respostas diferentes à mesma pergunta na mesma aplicação. Os dois termos seguintes
// são o histórico da própria clínica, que é a parte que faltava.

export function clamp01(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Mesmos três baldes horários de lib/noShowRisk.ts (HOUR_BUCKETS). Repetidos e não
// importados porque os módulos *Calc.ts são folhas por convenção — é o que permite
// correr `node --test` sobre eles sem empacotador. Se um dia divergirem, é um bug;
// o teste "os baldes horários coincidem com os de noShowRisk" tranca isso.
export const HOUR_BUCKETS = [
  { key: 'morning', startHour: 8, endHour: 12 },
  { key: 'afternoon', startHour: 12, endHour: 17 },
  { key: 'evening', startHour: 17, endHour: 20 },
];

export function hourBucketFor(hour: unknown) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return HOUR_BUCKETS[0].key;
  const found = HOUR_BUCKETS.find((b) => h >= b.startHour && h < b.endHour);
  return found ? found.key : HOUR_BUCKETS[HOUR_BUCKETS.length - 1].key;
}

// ─── 1. Como é que a clínica costuma perder lugares ─────────────────────────

export interface VacancyHistoryRow {
  apptDate: string | Date;
  startTime: string; // 'HH:MM[:SS]'
  outcome: 'attended' | 'no-show' | 'cancelled';
  // Dias de antecedência com que o cancelamento foi comunicado. Null para faltas
  // (não há aviso) e para consultas comparecidas.
  noticeDays?: number | null;
}

export interface CellStats {
  weekday: number;
  bucket: string;
  total: number;
  noShows: number;
  cancellations: number;
  // Dos cancelamentos, a fração comunicada com antecedência suficiente para dar tempo
  // de encher o lugar. É a variável que separa "perdeu-se" de "libertou-se".
  timelyCancelShare: number;
}

// Antecedência a partir da qual um cancelamento é, na prática, uma vaga oferecível:
// há tempo de correr a lista de espera, contactar e obter resposta. Dois dias é o
// mesmo horizonte que o job 'riskOutreach' já usa para contactar preventivamente
// (RISK_OUTREACH_LEAD_DAYS = 3, menos o dia de resposta).
export const TIMELY_NOTICE_DAYS = 2;

export function aggregateVacancyHistory(rows: VacancyHistoryRow[]): CellStats[] {
  const cells = new Map<string, { total: number; noShows: number; cancels: number; timely: number }>();
  for (const r of rows) {
    const weekday = new Date(r.apptDate).getUTCDay();
    const bucket = hourBucketFor(Number(String(r.startTime).slice(0, 2)));
    const key = `${weekday}:${bucket}`;
    const c = cells.get(key) || { total: 0, noShows: 0, cancels: 0, timely: 0 };
    c.total += 1;
    if (r.outcome === 'no-show') c.noShows += 1;
    if (r.outcome === 'cancelled') {
      c.cancels += 1;
      if ((r.noticeDays ?? 0) >= TIMELY_NOTICE_DAYS) c.timely += 1;
    }
    cells.set(key, c);
  }
  return Array.from(cells.entries())
    .map(([key, c]) => {
      const [weekday, bucket] = key.split(':');
      return {
        weekday: Number(weekday),
        bucket,
        total: c.total,
        noShows: c.noShows,
        cancellations: c.cancels,
        timelyCancelShare: c.cancels > 0 ? c.timely / c.cancels : 0,
      };
    })
    .sort((a, b) => (a.weekday !== b.weekday ? a.weekday - b.weekday : a.bucket < b.bucket ? -1 : 1));
}

// A repartição entre falta e cancelamento para uma célula. Com poucas observações a
// própria repartição é ruído, por isso cai para a média que o chamador passar (a da
// clínica inteira) — mesmo raciocínio da suavização em lib/patientScoringCalc.ts.
const MIN_CELL_OBSERVATIONS = 8;

export function noShowShareFor(cells: CellStats[], weekday: number, bucket: string, fallbackShare = 0.5): number {
  const cell = cells.find((c) => c.weekday === weekday && c.bucket === bucket);
  if (!cell) return clamp01(fallbackShare);
  const lost = cell.noShows + cell.cancellations;
  if (lost === 0) return clamp01(fallbackShare);
  if (cell.total < MIN_CELL_OBSERVATIONS) return clamp01(fallbackShare);
  return clamp01(cell.noShows / lost);
}

export function timelyCancelShareFor(cells: CellStats[], weekday: number, bucket: string, fallback = 0.6): number {
  const cell = cells.find((c) => c.weekday === weekday && c.bucket === bucket);
  if (!cell || cell.cancellations === 0 || cell.total < MIN_CELL_OBSERVATIONS) return clamp01(fallback);
  return clamp01(cell.timelyCancelShare);
}

// ─── 2. Conseguimos encher o lugar que se libertar? ─────────────────────────
// Três coisas mandam, e nenhuma delas é a taxa de ocupação da clínica:
//   • quantos dias faltam (uma vaga para amanhã é muito mais difícil de vender);
//   • quantas pessoas há na lista de espera que servem para aquele lugar;
//   • se, historicamente, vagas nesse dia/hora se encheram ou não.
//
// A profundidade da lista de espera satura depressa de propósito: ter dez candidatos
// em vez de três não triplica a probabilidade — as pessoas não estão de sobreaviso, e
// a segunda a quem se liga não é mais provável de aceitar do que a primeira.
export interface FillInputs {
  daysUntil: number;
  matchingWaitlistDepth: number;
  historicalFillRate?: number;
}

export function fillProbability(inputs: FillInputs): number {
  const days = Math.max(0, Number(inputs.daysUntil) || 0);
  // Uma vaga que aparece no próprio dia quase não se enche; a partir de uma semana
  // de antecedência o tempo deixa de ser o constrangimento.
  const timeFactor = clamp01(days / 7);
  const depth = Math.max(0, Number(inputs.matchingWaitlistDepth) || 0);
  const depthFactor = depth === 0 ? 0 : clamp01(1 - 2 ** (-depth / 2));
  const historical = inputs.historicalFillRate == null ? 0.5 : clamp01(inputs.historicalFillRate);

  // Sem ninguém compatível na lista de espera a probabilidade não é zero — a receção
  // ainda pode encher a vaga com quem telefonar nesse dia — mas é baixa, e é o
  // histórico que diz quanto. Com lista de espera, o tempo e a profundidade mandam.
  if (depth === 0) return clamp01(historical * timeFactor * 0.4);
  return clamp01(historical * (0.4 + 0.6 * timeFactor) * depthFactor);
}

// ─── 3. A probabilidade que interessa ───────────────────────────────────────

export interface SlotRiskInputs {
  // 0-100, de appointments.risk_score (lib/noShowRisk.ts). Não recalculado aqui.
  riskScore: number;
  weekday: number;
  bucket: string;
  daysUntil: number;
  matchingWaitlistDepth: number;
  historicalFillRate?: number;
  clinicNoShowShare?: number;
  clinicTimelyCancelShare?: number;
}

export interface SlotRisk {
  // P(o lugar esvazia-se), de 0 a 1 — o risk_score normalizado.
  vacancyProbability: number;
  // P(esvazia-se E fica vazio até ao fim). É este o número que vale um telefonema.
  emptyProbability: number;
  // A repartição, para a UI poder explicar. Somadas dão vacancyProbability.
  noShowProbability: number;
  recoverableProbability: number;
  fillProbability: number;
}

export function slotRisk(inputs: SlotRiskInputs, cells: CellStats[]): SlotRisk {
  const vacancy = clamp01((Number(inputs.riskScore) || 0) / 100);
  const noShowShare = noShowShareFor(cells, inputs.weekday, inputs.bucket, inputs.clinicNoShowShare ?? 0.5);
  const timelyShare = timelyCancelShareFor(cells, inputs.weekday, inputs.bucket, inputs.clinicTimelyCancelShare ?? 0.6);

  const noShowProbability = vacancy * noShowShare;
  const cancelProbability = vacancy * (1 - noShowShare);
  // Só os cancelamentos comunicados a tempo são recuperáveis. Um cancelamento na
  // véspera à noite conta, para este efeito, como uma falta: ninguém vai encher
  // aquilo.
  const recoverable = cancelProbability * timelyShare;
  const unrecoverableCancel = cancelProbability * (1 - timelyShare);

  const fill = fillProbability({
    daysUntil: inputs.daysUntil,
    matchingWaitlistDepth: inputs.matchingWaitlistDepth,
    historicalFillRate: inputs.historicalFillRate,
  });

  return {
    vacancyProbability: vacancy,
    noShowProbability,
    recoverableProbability: recoverable,
    fillProbability: fill,
    emptyProbability: clamp01(noShowProbability + unrecoverableCancel + recoverable * (1 - fill)),
  };
}

// ─── 4. Do slot para o dia ──────────────────────────────────────────────────
// Minutos que se espera perder num dia = Σ (duração × P(fica vazio)). Um valor
// esperado, não uma previsão de acontecimentos: "espera-se perder 95 minutos na
// terça" é acionável de uma forma que "3 consultas em risco" não é, porque põe a
// perda na mesma unidade em que o otimizador já mede o ganho.
export interface SlotProjection {
  appointmentId: string;
  patientName: string;
  date: string;
  startTime: string;
  chair: number;
  durationMinutes: number;
  risk: SlotRisk;
}

export interface DayProjection {
  date: string;
  expectedEmptyMinutes: number;
  bookedMinutes: number;
  // Fração dos minutos marcados que se espera perder. É o número comparável entre
  // dias com quantidades de trabalho diferentes.
  expectedLossRate: number;
  atRisk: SlotProjection[];
}

// Limiar acima do qual um slot entra na lista acionável. 0.35 e não 0.5: a decisão que
// isto informa é "vale a pena um telefonema de confirmação", não "vai de certeza
// ficar vazio", e um telefonema custa dois minutos.
export const SLOT_ACTIONABLE_THRESHOLD = 0.35;

export function projectByDay(slots: SlotProjection[], threshold = SLOT_ACTIONABLE_THRESHOLD): DayProjection[] {
  const byDate = new Map<string, SlotProjection[]>();
  for (const s of slots) {
    const list = byDate.get(s.date) || [];
    list.push(s);
    byDate.set(s.date, list);
  }

  return Array.from(byDate.entries())
    .map(([date, list]) => {
      const bookedMinutes = list.reduce((sum, s) => sum + s.durationMinutes, 0);
      const expectedEmptyMinutes = list.reduce((sum, s) => sum + s.durationMinutes * s.risk.emptyProbability, 0);
      return {
        date,
        bookedMinutes,
        expectedEmptyMinutes: Math.round(expectedEmptyMinutes),
        expectedLossRate: bookedMinutes > 0 ? expectedEmptyMinutes / bookedMinutes : 0,
        atRisk: list
          .filter((s) => s.risk.emptyProbability >= threshold)
          .sort((a, b) =>
            b.risk.emptyProbability !== a.risk.emptyProbability
              ? b.risk.emptyProbability - a.risk.emptyProbability
              : a.startTime < b.startTime
                ? -1
                : 1,
          ),
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// A leitura em português de um slot em risco, para a UI não ter de a montar em três
// sítios diferentes com três formulações diferentes.
export function explainSlotRisk(risk: SlotRisk): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (risk.vacancyProbability < 0.05) return 'Sem risco relevante.';
  if (risk.noShowProbability > risk.recoverableProbability) {
    return `${pct(risk.emptyProbability)} de ficar vazio — sobretudo por falta sem aviso, que não dá para recuperar. Confirmar a consulta é o que resta.`;
  }
  if (risk.fillProbability >= 0.5) {
    return `${pct(
      risk.vacancyProbability,
    )} de se libertar, mas com ${pct(risk.fillProbability)} de se voltar a encher — risco efetivo de ${pct(risk.emptyProbability)}.`;
  }
  return `${pct(risk.emptyProbability)} de ficar vazio — se cair, não há quem o ocupe (${pct(
    risk.fillProbability,
  )} de reposição). Vale a pena reforçar a lista de espera para este horário.`;
}
