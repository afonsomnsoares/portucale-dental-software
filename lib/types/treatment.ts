export interface Treatment {
  id: string;
  tenant_id: string | null;
  patient_id: string;
  patient_name: string | null;
  tooth_num: number | null;
  treatment_code: string | null;
  description: string;
  phase: number;
  status: string;
  fee: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TreatmentPlan {
  id: string;
  tenant_id: string | null;
  patient_id: string;
  patient_name: string | null;
  title: string;
  description: string;
  phases: Array<{
    phase?: number | string;
    treatmentCode?: string;
    description?: string;
    fee?: number | string;
    notes?: string;
  }>;
  total_fee: number;
  status: string;
  approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
