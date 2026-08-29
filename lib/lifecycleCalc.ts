// Pure helpers for the Patient Lifecycle engine — no DB imports so they are unit-testable.
// Mirrors the style of lib/recoveryCalc.ts and lib/noShowRisk.ts: a deterministic,
// explainable derivation from signals already on the patient/treatments/appointments
// tables, not a stored/mutable field. That matters here specifically because
// `patients.status` is already used by the floor/check-in flow (waiting/in-operatory/
// ready-dismissal/departed — see app/api/appointments/[id]/status/route.ts), so the
// lifecycle stage can never live there; computing it fresh also means it can never
// drift out of sync the way a stored "stage" column would.

// Kept in sync with RECOVERY_DEFAULTS.inactiveMonths in lib/recoveryCalc.ts (same "6
// months lapsed" threshold as the Revenue Recovery inactive_patients category) — not
// imported from there, because lib/*Calc.ts pure modules are deliberately leaf modules
// (no cross-imports) so `node --test` can run them directly without a bundler.
const LIFECYCLE_INACTIVE_MONTHS = 6;

export type LifecycleStageKey = 'new' | 'in_treatment' | 'stable' | 'inactive';

export const LIFECYCLE_STAGES: Array<{ key: LifecycleStageKey; label: string; description: string }> = [
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
    description: `Sem visita (ou registo) há mais de ${LIFECYCLE_INACTIVE_MONTHS} meses, sem nada agendado.`,
  },
];

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
  inactiveMonths: number = LIFECYCLE_INACTIVE_MONTHS,
): LifecycleStageKey {
  if (signals.hasOpenTreatment || signals.hasFutureAppointment) return 'in_treatment';

  const staleDate = Number(signals.visitCount) > 0 ? signals.lastVisit : signals.createdAt;
  const cutoff = monthsBefore(now, inactiveMonths);
  if (!staleDate || new Date(staleDate) < cutoff) return 'inactive';

  if (Number(signals.visitCount) === 0) return 'new';

  return 'stable';
}
