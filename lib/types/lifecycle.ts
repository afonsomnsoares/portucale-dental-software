export interface Lead {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  patient_id?: string | null;
  created_at: string;
  updated_at: string;
}

// The 8-stage pipeline shown in /dashboard/*/lifecycle (Lead → Marcação → Primeira
// Consulta → Plano → Aceitação → Tratamento → Conclusão → Recall → Nova Consulta —
// 'lead' itself is the separate `leads` column below, not one of these 8). Mirrors
// lib/patientJourneyCalc.ts's JourneyStageKey — kept as its own type here (not imported
// from lib/, which is server-only) the same way the rest of this file mirrors its
// server-side counterparts for client consumption.
export type JourneyStageKey =
  | 'booked'
  | 'first_visit_done'
  | 'plan_presented'
  | 'plan_accepted'
  | 'in_treatment'
  | 'completed'
  | 'recall_due'
  | 'booked_again';

export interface JourneyNextAction {
  code: string;
  label: string;
}

export interface JourneyPatient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  visit_count: number;
  last_visit: string | null;
  created_at: string;
  next_action: JourneyNextAction;
}

export interface JourneyStageGroup {
  key: JourneyStageKey;
  label: string;
  description: string;
  count: number;
  patients: JourneyPatient[];
}

// Mirrors lib/lifecycleCalc.ts's DormancyBand/ValueTier — item 7's segmentação, so a
// dormant-18-months high-value patient stands out from a low-value one-time visitor in
// the same 'inactive' bucket.
export type DormancyBand = '6-12m' | '12-24m' | '24m+';
export type ValueTier = 'high' | 'standard';

export interface ReactivationCandidate {
  patientId: string;
  name: string;
  phone: string | null;
  segment: { dormancyBand: DormancyBand; valueTier: ValueTier };
}

export interface LifecycleData {
  generatedAt: string;
  leads: Lead[];
  stages: JourneyStageGroup[];
  reactivationCandidates: ReactivationCandidate[];
}
