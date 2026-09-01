export interface CommPrefs {
  preferredChannel?: 'sms' | 'email' | 'phone' | 'whatsapp';
  doNotContact?: ('sms' | 'email' | 'phone')[];
  language?: string;
}

export interface Patient {
  id: string;
  tenant_id: string | null;
  global_seq: number;
  name: string;
  dob: string | null;
  phone: string | null;
  email: string | null;
  insurance: string | null;
  balance: number;
  status: string;
  custom_fields: Record<string, unknown>;
  no_show_count: number;
  visit_count: number;
  last_visit: string | null;
  created_at: string;
  no_show_score: number | null;
  alerts: string[];
  nif?: string;
  address?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  data_consent_given?: boolean;
  data_consent_date?: string | null;
  comm_prefs?: CommPrefs;
}
