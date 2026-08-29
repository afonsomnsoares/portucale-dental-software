export interface AuditLogEntry {
  id: string | number;
  user_name: string;
  user_role: string;
  clinic: string;
  action: string;
  resource: string;
  before_val: string | null;
  after_val: string | null;
  hash: string | null;
  created_at: string;
}

export interface TimelineEvent {
  id: string | number;
  patient_id?: string;
  user_name: string;
  user_role: string;
  event_type: string;
  event: string;
  hash?: string | null;
  created_at: string;
}
