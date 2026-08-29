export interface Tooth {
  id: string;
  patient_id: string;
  tooth_num: number;
  condition: string;
  surfaces: string[];
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

// The per-tooth map returned by GET /api/patients/[id]/teeth, keyed by tooth number.
export interface ToothState {
  condition: string;
  surfaces: string[];
  notes: string;
}
