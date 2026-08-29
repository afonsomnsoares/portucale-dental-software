export interface Invoice {
  id: string;
  tenant_id: string | null;
  patient_id: string;
  patient_name: string | null;
  dentist_id: string | null;
  dentist_name: string | null;
  amount: number;
  paid: number;
  method: string;
  status: string;
  invoice_date: string;
  due_date: string | null;
  items: Array<{ description?: string; amount?: number; qty?: number }>;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
