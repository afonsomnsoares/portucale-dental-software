export interface Recall {
  id: string;
  tenant_id: string | null;
  patient_id: string;
  patient_name: string | null;
  recall_type: string;
  interval_months: number;
  last_done: string | null;
  next_due: string | null;
  notes: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
