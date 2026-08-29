export interface Prescription {
  id: string;
  tenant_id: string | null;
  patient_id: string;
  patient_name: string | null;
  medication: string;
  dosage: string;
  frequency: string;
  route: string;
  duration: string;
  quantity: number;
  refills: number;
  instructions: string;
  notes: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
