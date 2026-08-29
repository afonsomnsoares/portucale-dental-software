export interface Lead {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  status: string;
  notes: string | null;
  patient_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type LifecycleStageKey = 'new' | 'in_treatment' | 'stable' | 'inactive';

export interface LifecyclePatient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  visit_count: number;
  last_visit: string | null;
  created_at: string;
}

export interface LifecycleStageGroup {
  key: LifecycleStageKey;
  label: string;
  description: string;
  count: number;
  patients: LifecyclePatient[];
}

export interface LifecycleData {
  generatedAt: string;
  leads: Lead[];
  stages: LifecycleStageGroup[];
}
