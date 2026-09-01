export type InteractionChannel = 'phone' | 'email' | 'whatsapp' | 'sms' | 'in_person' | 'other';
export type InteractionDirection = 'inbound' | 'outbound';

export interface PatientInteraction {
  id: string;
  tenant_id: string;
  patient_id: string;
  channel: InteractionChannel;
  direction: InteractionDirection;
  summary: string;
  occurred_at: string;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
}
