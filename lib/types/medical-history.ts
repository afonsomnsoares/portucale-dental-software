export interface MedicalHistory {
  id: string;
  patient_id: string;
  tenant_id: string | null;
  allergies: string;
  medications: string;
  conditions: string;
  family_history: string;
  smoking: string;
  pregnancy: string;
  notes: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}
