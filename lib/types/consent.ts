export interface ConsentForm {
  id: string;
  tenant_id: string | null;
  patient_id: string;
  patient_name: string | null;
  procedure_name: string;
  description: string;
  signed_by: string;
  signature_url: string;
  storage_key: string;
  file_size: number;
  created_by: string | null;
  created_at: string;
}
