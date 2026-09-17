// Pure helper — no DB imports, unit-testable like lib/lifecycleCalc.ts.
//
// This is a finer-grained sibling of lib/lifecycleCalc.ts's 4-stage model
// (new/in_treatment/stable/inactive) — that one stays exactly as-is because
// jobsRunner's reactivation SMS automation and the persisted
// patient_lifecycle_state table are built on it (see lib/lifecycle.ts's
// computeLifecycleTransitions). This module is display/prioritization only:
// it answers "where is this patient in the Lead → ... → Nova Consulta
// pipeline right now", for the Kanban view in lib/patientJourney.ts.
//
// 'lead' itself isn't a key here — leads live in their own table and are
// rendered as a separate column (see app/api/lifecycle/route.ts's
// listOpenLeads) exactly as before. This covers the 8 stages a *patient*
// (already converted) can be in.

export type JourneyStageKey =
  | 'lead'
  | 'booked'
  | 'first_visit_done'
  | 'plan_presented'
  | 'plan_accepted'
  | 'in_treatment'
  | 'completed'
  | 'recall_due'
  | 'booked_again';

export const JOURNEY_STAGES: Array<{ key: JourneyStageKey; label: string; description: string }> = [
  // ─── A jornada começa antes de haver doente ───────────────────────────────
  // 'lead' é a única etapa que computeJourneyStage() NUNCA devolve, e é de propósito:
  // essa função recebe sinais de um DOENTE (visitas, planos, tratamentos) e um lead não
  // é um doente — não tem ficha, não tem histórico, e pode nunca vir a ter. Quem povoa
  // esta etapa é computeJourneyPipeline (lib/patientJourney.ts), a partir da tabela
  // `leads`.
  //
  // Está aqui na mesma porque o funil é um só. Enquanto o catálogo começava em
  // «Marcação», qualquer leitura do modelo — a página, um agente, um relatório — via uma
  // jornada que começa a meio, e a pergunta «quantas pessoas estão em cada fase» tinha
  // duas respostas em dois sítios. A ponte nos dados já existia (leads.patient_id, escrito
  // na conversão em app/api/leads/route.ts); o que faltava era o catálogo dizer o mesmo.
  { key: 'lead', label: 'Lead', description: 'Primeiro contacto, ainda sem consulta marcada.' },
  { key: 'booked', label: 'Marcação', description: 'Marcado mas ainda sem primeira consulta realizada.' },
  {
    key: 'first_visit_done',
    label: 'Primeira Consulta',
    description: 'Primeira consulta feita, sem plano apresentado ainda.',
  },
  {
    key: 'plan_presented',
    label: 'Plano Apresentado',
    description: 'Plano de tratamento apresentado, aguarda decisão do paciente.',
  },
  { key: 'plan_accepted', label: 'Aceitação', description: 'Plano aceite, tratamento ainda não iniciado.' },
  { key: 'in_treatment', label: 'Tratamento', description: 'Tratamento em curso.' },
  { key: 'completed', label: 'Conclusão', description: 'Tratamento concluído, sem recall agendado ainda.' },
  { key: 'recall_due', label: 'Recall', description: 'Recall agendado e vencido — precisa de contacto.' },
  { key: 'booked_again', label: 'Nova Consulta', description: 'Já voltou a marcar — ciclo reiniciado.' },
];

export interface JourneySignals {
  visitCount: number;
  hasFutureAppointment: boolean;
  hasOpenTreatment: boolean; // treatments.status IN ('proposed','accepted')
  hasCompletedTreatment: boolean; // at least one treatments.status = 'completed'
  hasOpenPlan: boolean; // a treatment_plans row with approved = FALSE
  hasAcceptedPlanNoTreatment: boolean; // an approved plan, but no treatment past 'proposed' yet
  recallDue: boolean; // an active recall with next_due in the past (or today)
}

// Priority is a fixed list, most concrete/current-activity first — the first rule that
// matches wins, so ordering IS the policy (same style as lib/nextAction.ts). Active
// clinical work (in_treatment) always wins over a newer plan being proposed in parallel;
// an already-rebooked patient (booked_again) wins over a merely-overdue recall, since
// they've effectively already returned before the automation caught up with them.
// Devolve sempre uma etapa de DOENTE — nunca 'lead'. Ver o comentário em JOURNEY_STAGES.
export function computeJourneyStage(signals: JourneySignals): Exclude<JourneyStageKey, 'lead'> {
  if (signals.hasOpenTreatment) return 'in_treatment';
  if (signals.hasOpenPlan) return 'plan_presented';
  if (signals.hasAcceptedPlanNoTreatment) return 'plan_accepted';
  if (signals.hasFutureAppointment && signals.visitCount > 0) return 'booked_again';
  // A recall presupposes at least one prior visit — a patient with visit_count 0 can end
  // up with a `recalls` row through bulk-import/manual data entry (a recall
  // schedule set up ahead of their actual first visit), but "overdue for their regular
  // checkup" doesn't apply to someone who's never been seen yet.
  if (signals.recallDue && signals.visitCount > 0) return 'recall_due';
  if (signals.hasCompletedTreatment) return 'completed';
  if (signals.visitCount > 0) return 'first_visit_done';
  return 'booked';
}
