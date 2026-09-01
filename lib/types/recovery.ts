export interface RecoveryItem {
  id?: string;
  patient_id?: string | null;
  patient_name: string;
  phone?: string | null;
  email?: string | null;
  value: number;
  detail: string;
  // Only set on plan-based categories (plans_pending_decision, plans_not_started) —
  // days since the plan was presented/approved. Used to badge stale items in the UI.
  daysSince?: number | null;
}

export interface RecoveryCategory {
  key: string;
  label: string;
  description: string;
  action: string;
  count: number;
  estimatedValue: number;
  items: RecoveryItem[];
}

export interface RecoverySnapshot {
  snapshot_month: string;
  total_estimated: number;
}

export interface RecoveryData {
  tenant: { id: string; name: string; operatories: number };
  generatedAt: string;
  total: number;
  categories: RecoveryCategory[];
  snapshots: RecoverySnapshot[];
}
