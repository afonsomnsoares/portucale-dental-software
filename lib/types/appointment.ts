export interface Appointment {
  id: string;
  tenant_id: string | null;
  patient_id: string;
  patient_name: string | null;
  dentist_id: string | null;
  dentist_name: string | null;
  chair: number;
  appt_date: string;
  start_time: string;
  duration: number;
  type: string;
  status: string;
  risk_score: number | null;
  notes: string | null;
  created_at: string;
}
