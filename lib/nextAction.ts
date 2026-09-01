// Pure helper — no DB imports, unit-testable like lib/lifecycleCalc.ts.
// app/api/patients/[id]/next-action/route.ts gathers the signals (patient
// row, missing fields from lib/missingData.ts, open task count, whether a
// future appointment exists, lifecycle stage from lib/lifecycleCalc.ts, the
// oldest still-unaccepted treatment plan) and hands them here. Priority is a
// fixed list, most urgent first — the first rule that matches wins, so
// ordering IS the policy.

import type { MissingField } from './missingData';

export interface NextActionSignals {
  missingFields: MissingField[];
  openTaskCount: number;
  hasUpcomingAppointment: boolean;
  lifecycleStage: 'new' | 'in_treatment' | 'stable' | 'inactive' | null;
  oldestPendingPlanDays: number | null; // days since a treatment_plan was created and is still not approved
}

export type NextActionCode =
  | 'MISSING_DATA'
  | 'OPEN_TASKS'
  | 'PLAN_NOT_ACCEPTED'
  | 'NO_UPCOMING_VISIT'
  | 'REACTIVATE'
  | 'UP_TO_DATE';

export interface NextAction {
  code: NextActionCode;
  label: string;
}

const PLAN_STALE_DAYS = 14;

export function computeNextAction(signals: NextActionSignals): NextAction {
  if (signals.missingFields.length > 0) {
    return {
      code: 'MISSING_DATA',
      label: `Dados em falta (${signals.missingFields.map((f) => f.label).join(', ')}) — pedir informação ao paciente`,
    };
  }

  if (signals.openTaskCount > 0) {
    return {
      code: 'OPEN_TASKS',
      label: `${signals.openTaskCount} tarefa${signals.openTaskCount > 1 ? 's' : ''} em aberto para este paciente`,
    };
  }

  if (signals.oldestPendingPlanDays !== null && signals.oldestPendingPlanDays >= PLAN_STALE_DAYS) {
    return {
      code: 'PLAN_NOT_ACCEPTED',
      label: `Plano de tratamento apresentado há ${signals.oldestPendingPlanDays} dias sem aceitação — fazer follow-up`,
    };
  }

  if (signals.lifecycleStage === 'inactive') {
    return {
      code: 'REACTIVATE',
      label: 'Paciente inativo — candidato a reativação',
    };
  }

  if (!signals.hasUpcomingAppointment && signals.lifecycleStage !== 'new') {
    return {
      code: 'NO_UPCOMING_VISIT',
      label: 'Sem próxima consulta marcada — sugerir marcação',
    };
  }

  return { code: 'UP_TO_DATE', label: 'Sem ação necessária' };
}
