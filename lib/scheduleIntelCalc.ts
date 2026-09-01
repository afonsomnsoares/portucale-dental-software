// Pure helpers for the Agenda Inteligente engine — no DB imports, unit-testable like
// lib/recoveryCalc.ts and lib/noShowRisk.ts. lib/scheduleIntel.ts's computeAgendaEfficiency
// already computes everything descriptive (utilization by chair/dentist, fragmentation,
// last-minute cancellations, waitlist demand by weekday) — this turns that into the
// actionable "maximizar a utilização da capacidade disponível" the spec asks for.

const WEEKDAY_LABEL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export interface UtilizationUnit {
  utilizationPct: number;
}

export interface ChairUtilization extends UtilizationUnit {
  chair: number;
}

export interface DentistUtilization extends UtilizationUnit {
  dentistId: string;
  dentistName: string;
}

export interface WaitlistDemandDay {
  weekday: number;
  demand: number;
}

export interface CapacitySuggestion {
  kind: 'chair' | 'dentist' | 'waitlist_demand';
  subject: string; // "Cadeira 2", "Dr. Silva", "Terça-feira"
  detail: string;
}

// How far below the group average a unit's utilization has to be before it's worth
// calling out — a round, explainable threshold, same style as RECOVERY_DEFAULTS in
// lib/recoveryCalc.ts, not a statistically-derived one.
const UNDERUTILIZED_GAP_PCT = 20;
// The waitlist has to be at least this much busier than the average weekday before it's
// worth pointing reception at a specific day.
const HIGH_DEMAND_FACTOR = 1.5;

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// Flags chairs/dentists sitting well below the average utilization of their own peer
// group (other chairs, other dentists) — "this specific one is underused relative to the
// rest of the clinic", not an absolute threshold that would flag a clinic that's quiet
// everywhere equally (nothing to move capacity *toward* in that case).
export function findUnderutilizedUnits<T extends UtilizationUnit>(
  units: T[],
  gapPct: number = UNDERUTILIZED_GAP_PCT,
): T[] {
  if (units.length < 2) return [];
  const avg = average(units.map((u) => u.utilizationPct));
  return units.filter((u) => avg - u.utilizationPct >= gapPct);
}

// Weekdays where the waitlist is meaningfully busier than an average weekday — worth
// prioritizing when a slot on that day frees up (see lib/waitlist.ts's matching, which
// already ranks by FIFO but has no day-of-week awareness of its own).
export function findHighDemandWeekdays(
  demand: WaitlistDemandDay[],
  factor: number = HIGH_DEMAND_FACTOR,
): WaitlistDemandDay[] {
  const avg = average(demand.map((d) => d.demand));
  if (avg <= 0) return [];
  return demand.filter((d) => d.demand >= avg * factor && d.demand > 0);
}

// Combines both signals into ready-to-display suggestions — the "objetivo: maximizar a
// utilização da capacidade disponível" turned into concrete sentences instead of raw
// numbers the reader has to interpret themselves.
export function suggestCapacityMoves(
  byChair: ChairUtilization[],
  byDentist: DentistUtilization[],
  waitlistDemandByWeekday: WaitlistDemandDay[],
): CapacitySuggestion[] {
  const suggestions: CapacitySuggestion[] = [];

  for (const c of findUnderutilizedUnits(byChair)) {
    suggestions.push({
      kind: 'chair',
      subject: `Cadeira ${c.chair}`,
      detail: `Ocupação de ${c.utilizationPct}%, bem abaixo da média das outras cadeiras — considere mover marcações para aqui.`,
    });
  }
  for (const d of findUnderutilizedUnits(byDentist)) {
    suggestions.push({
      kind: 'dentist',
      subject: d.dentistName,
      detail: `Ocupação de ${d.utilizationPct}%, bem abaixo da média dos outros dentistas.`,
    });
  }
  for (const w of findHighDemandWeekdays(waitlistDemandByWeekday)) {
    suggestions.push({
      kind: 'waitlist_demand',
      subject: WEEKDAY_LABEL[w.weekday] || String(w.weekday),
      detail: `A lista de espera tem procura acima da média para este dia — priorize vagas libertadas às ${WEEKDAY_LABEL[w.weekday]?.toLowerCase() || w.weekday}s.`,
    });
  }

  return suggestions;
}
