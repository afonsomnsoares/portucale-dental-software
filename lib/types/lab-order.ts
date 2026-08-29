export interface LabOrder {
  id: string;
  tenant_id: string | null;
  patient_id: string;
  patient_name: string | null;
  lab_name: string;
  case_type: string;
  tooth_nums: string;
  description: string;
  instructions: string;
  due_date: string | null;
  fee: number;
  status: string;
  created_by: string | null;
  received_by: string | null;
  received_at: string | null;
  created_at: string;
  updated_at: string;
}
