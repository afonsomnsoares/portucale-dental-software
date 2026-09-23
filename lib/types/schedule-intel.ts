export interface RiskFactors {
  patientNoShowRate: number;
  patientCancelRate: number;
  weekdayBaseRate: number;
  hourBaseRate: number;
  leadTime: number;
  newPatient: number;
}

export interface RiskAppointment {
  id: string;
  patient_id: string;
  patient_name: string;
  phone?: string | null;
  appt_date: string;
  start_time: string;
  type: string;
  score: number;
  factors: RiskFactors;
  // Da lista de espera, quem pode ficar com o lugar se este doente faltar — escolhidos
  // pela tarefa 'riskOutreach' quando pediu a confirmação. Vazio antes disso.
  standby?: Array<{ patientId: string; name: string; phone: string | null }>;
}

export interface RiskData {
  generatedAt: string;
  days: number;
  appointments: RiskAppointment[];
  highRisk: RiskAppointment[];
}

export interface RiskHeatmapCell {
  weekday: number;
  bucket: string;
  total: number;
  risky: number;
  rate: number;
}

export interface RiskHeatmapData {
  generatedAt: string;
  cells: RiskHeatmapCell[];
  sampleSize: number;
  historyMonths: number;
}

export interface UnitUtilization {
  bookedMinutes: number;
  capacityMinutes: number;
  utilizationPct: number;
}

export interface DentistUtilization extends UnitUtilization {
  dentistId: string;
  dentistName: string;
}

export interface ChairUtilization extends UnitUtilization {
  chair: number;
}

export interface WaitlistDemandByWeekday {
  weekday: number;
  demand: number;
}

// See lib/scheduleIntelCalc.ts's suggestCapacityMoves.
export interface CapacitySuggestion {
  kind: 'chair' | 'dentist' | 'waitlist_demand';
  subject: string;
  detail: string;
}

export interface AgendaEfficiency {
  generatedAt: string;
  operatories: number;
  windowDays: number;
  utilizationPct: number;
  bookedMinutes: number;
  capacityMinutes: number;
  fragmentation: { gapCount: number; gapMinutes: number };
  lastMinuteCancellations: { total: number; withinTwoDays: number };
  byDentist: DentistUtilization[];
  byChair: ChairUtilization[];
  waitlistDemandByWeekday: WaitlistDemandByWeekday[];
  suggestions: CapacitySuggestion[];
}

export interface WaitlistEntry {
  id: string;
  patient_id: string;
  patient_name: string;
  phone?: string | null;
  email?: string | null;
  treatment_type: string;
  preferred_dentist_id: string | null;
  preferred_days: number[] | null;
  preferred_time_start: string | null;
  preferred_time_end: string | null;
  min_duration: number;
  max_wait_until: string | null;
  notes: string;
  status: 'active' | 'offered' | 'fulfilled' | 'expired' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export interface SlotOffer {
  id: string;
  waitlist_entry_id: string;
  patient_id: string | null;
  patient_name?: string | null;
  phone?: string | null;
  treatment_type: string;
  offered_date: string;
  offered_start_time: string;
  offered_duration: number;
  offered_chair: number | null;
  offered_dentist_id: string | null;
  status: 'sent' | 'accepted' | 'declined' | 'expired';
  created_at: string;
  responded_at: string | null;
}

export interface WaitlistData {
  entries: WaitlistEntry[];
  pendingOffers: SlotOffer[];
}

// ─── Otimizador da agenda (item 9) ────────────────────────────────────────
// Ver lib/scheduleOptimizerCalc.ts. `gainMinutes` é 0 nas propostas que
// melhoram a qualidade da marcação sem alterar a ocupação (dentista em falta,
// preferência do doente violada) — só as outras somam para recoverableMinutes.
// Espelha OptimizerMoveKind de lib/scheduleOptimizerCalc.ts. Estava três tipos atrás do
// servidor — 'group_visit', 'pull_forward' e 'consolidate' já eram calculados e chegavam
// ao ecrã sem etiqueta, porque o KIND_META do componente é indexado por este tipo e não
// os conhecia. Falhava em silêncio: a proposta aparecia sem categoria em vez de dar erro.
export type OptimizerMoveKind =
  | 'gap_fill'
  | 'unassigned_dentist'
  | 'equipment_block'
  | 'preference_mismatch'
  | 'group_visit'
  | 'pull_forward'
  | 'consolidate';

/** O destino de uma proposta aplicável — ver OptimizerApply em lib/scheduleOptimizerCalc.ts. */
export interface OptimizerApply {
  appointmentId: string;
  date: string;
  startTime: string;
  chair: number;
  dentistId: string | null;
  notifiesPatient: boolean;
}

export interface OptimizerMove {
  kind: OptimizerMoveKind;
  key: string;
  title: string;
  detail: string;
  gainMinutes: number;
  appointmentId?: string;
  appointmentIds?: string[];
  advanceDays?: number;
  consolidatedMinutes?: number;
  patientName?: string;
  date?: string;
  /** Ausente nas propostas cuja execução é uma conversa e não um UPDATE. */
  apply?: OptimizerApply;
}

export interface ScheduleOptimization {
  windowDays: number;
  generatedAt: string;
  moves: OptimizerMove[];
  totals: { moves: number; recoverableMinutes: number; advancedDays?: number; consolidatedMinutes?: number };
  warnings: string[];
}

// ─── Preferências de agendamento do doente (item 9) ───────────────────────
export interface PatientSchedulingPrefs {
  id: string;
  tenant_id: string;
  patient_id: string;
  preferred_dentist_id: string | null;
  preferred_dentist_name?: string | null;
  preferred_days: number[] | null;
  preferred_time_start: string | null;
  preferred_time_end: string | null;
  notes: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
