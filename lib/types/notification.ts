export interface Notification {
  id: string;
  tenant_id: string;
  patient_id: string | null;
  patient_name: string | null;
  appointment_id: string | null;
  channel: string;
  to_addr: string | null;
  payload: { kind?: string; body?: string } | null;
  status: 'queued' | 'sent' | 'failed' | 'retry';
  provider_id: string | null;
  attempts: number;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}
