// Pure helpers for the Patient Lifecycle engine — no DB imports so they are unit-testable.
// Mirrors the style of lib/recoveryCalc.ts and lib/noShowRisk.ts: a deterministic,
// explainable derivation from signals already on the patient/treatments/appointments
// tables, not a stored/mutable field. That matters here specifically because
// `patients.status` is already used by the floor/check-in flow (waiting/in-operatory/
// ready-dismissal/departed — see app/api/appointments/[id]/status/route.ts), so the
// lifecycle stage can never live there; computing it fresh also means it can never
// drift out of sync the way a stored "stage" column would.

// O valor por omissão — o que vale para uma clínica que nunca mexeu na definição, e o
// que o código inteiro fazia antes de a definição existir. A partir da migração 060 o
// número real vive em `tenants.inactive_after_months` e chega aqui por parâmetro: seis
// meses não é um facto sobre medicina dentária, é uma opinião sobre o intervalo normal
// entre visitas, e esse intervalo muda com o tipo de clínica (ver o cabeçalho da
// migração).
//
// Continua repetido em RECOVERY_DEFAULTS.inactiveMonths (lib/recoveryCalc.ts) e não
// importado de lá porque os módulos *Calc.ts são folhas por convenção — é o que permite
// correr `node --test` sobre eles sem empacotador. A diferença face ao que aqui estava
// antes é que já não são duas VERDADES a precisarem de sincronia: são dois valores por
// omissão para o mesmo campo, e quem manda é a coluna.
export const DEFAULT_INACTIVE_MONTHS = 6;

export type LifecycleStageKey = 'new' | 'in_treatment' | 'stable' | 'inactive';

export function lifecycleStages(
  inactiveMonths: number = DEFAULT_INACTIVE_MONTHS,
): Array<{ key: LifecycleStageKey; label: string; description: string }> {
  return [
    { key: 'new', label: 'Novo Paciente', description: 'Registado mas ainda sem consultas concluídas.' },
    {
      key: 'in_treatment',
      label: 'Em Tratamento',
      description: 'Tratamento ou plano em aberto, ou consulta futura marcada.',
    },
    {
      key: 'stable',
      label: 'Terminado',
      description: 'Sem tratamento em aberto, visitado recentemente — ciclo de manutenção/recall.',
    },
    {
      key: 'inactive',
      label: 'Desaparecido',
      description: `Sem visita (ou registo) há mais de ${inactiveMonths} meses, sem nada agendado.`,
    },
  ];
}

/** O catálogo com o limiar por omissão, para quem não tem clínica à mão. */
export const LIFECYCLE_STAGES = lifecycleStages();

export interface LifecycleSignals {
  visitCount: number;
  lastVisit: string | Date | null;
  createdAt: string | Date;
  hasOpenTreatment: boolean;
  hasFutureAppointment: boolean;
}

// Reactivation outreach (queueLifecycleOutreach in lib/jobsRunner.ts) targets patients
// in the 'inactive' stage. Two constants govern that loop:
// - the RGPD consent_type it checks for in patient_data_consents before contacting anyone
// - how long to wait before re-contacting someone who didn't respond (a rolling cooldown,
//   not a one-shot dedupe like appointment reminders get — a dormant patient can still be
//   dormant next month, so "already messaged once, ever" isn't the right suppression rule).
export const REACTIVATION_CONSENT_TYPE = 'marketing_outreach';
export const REACTIVATION_COOLDOWN_DAYS = 30;

// True when a patient has never been sent a reactivation message, or the last one was
// far enough in the past that trying again is reasonable rather than spammy.
export function isOutreachDue(
  lastOutreachAt: string | Date | null | undefined,
  now: Date = new Date(),
  cooldownDays: number = REACTIVATION_COOLDOWN_DAYS,
): boolean {
  if (!lastOutreachAt) return true;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - cooldownDays);
  return new Date(lastOutreachAt) < cutoff;
}

function monthsBefore(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() - months);
  return d;
}

export function computeLifecycleStage(
  signals: LifecycleSignals,
  now: Date = new Date(),
  inactiveMonths: number = DEFAULT_INACTIVE_MONTHS,
): LifecycleStageKey {
  if (signals.hasOpenTreatment || signals.hasFutureAppointment) return 'in_treatment';

  const staleDate = Number(signals.visitCount) > 0 ? signals.lastVisit : signals.createdAt;
  const cutoff = monthsBefore(now, inactiveMonths);
  if (!staleDate || new Date(staleDate) < cutoff) return 'inactive';

  if (Number(signals.visitCount) === 0) return 'new';

  return 'stable';
}

// ─── Reativação: segmentação (item 7 — "este paciente costumava vir
// regularmente e não aparece há 18 meses") ─────────────────────────────────
// Turns a flat "everyone who's inactive" list into something a receptionist can
// prioritize: how long they've actually been gone, and whether they were a
// high-value patient historically — so a high-value patient dormant 18 months
// (the user's own example) doesn't sit in the same bucket as someone who
// visited once for a cheap cleaning 6 months ago.

export type DormancyBand = '6-12m' | '12-24m' | '24m+';
export type ValueTier = 'high' | 'standard';

// Same floor as the clinic's inactivity threshold — a candidate is only ever
// segmented once they're already 'inactive', so the bands start where that ends.
export function dormancyBand(monthsInactive: number): DormancyBand {
  if (monthsInactive >= 24) return '24m+';
  if (monthsInactive >= 12) return '12-24m';
  return '6-12m';
}

// Arbitrary-but-explainable threshold, same style as RECOVERY_DEFAULTS in
// lib/recoveryCalc.ts (round numbers, documented, easy for an admin to reason about
// rather than a statistically-derived cutoff nobody can eyeball).
export const HIGH_VALUE_LIFETIME_THRESHOLD = 500;

export function valueTier(lifetimeValue: number): ValueTier {
  return Number(lifetimeValue) >= HIGH_VALUE_LIFETIME_THRESHOLD ? 'high' : 'standard';
}

export interface ReactivationSegmentSignals {
  monthsInactive: number;
  lifetimeValue: number;
}

export interface ReactivationSegment {
  dormancyBand: DormancyBand;
  valueTier: ValueTier;
}

export function segmentReactivationCandidate(signals: ReactivationSegmentSignals): ReactivationSegment {
  return {
    dormancyBand: dormancyBand(signals.monthsInactive),
    valueTier: valueTier(signals.lifetimeValue),
  };
}
