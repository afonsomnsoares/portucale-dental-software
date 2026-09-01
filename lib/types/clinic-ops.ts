export type ChecklistType = 'opening' | 'closing' | 'other';

export interface ChecklistTemplate {
  id: string;
  tenant_id: string;
  name: string;
  type: ChecklistType;
  items: string[];
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistRunItemRow {
  label: string;
  checked: boolean;
  checkedBy: string | null;
  checkedByName: string | null;
  checkedAt: string | null;
}

export type ChecklistRunStatus = 'in_progress' | 'completed';

export interface ChecklistRun {
  id: string;
  tenant_id: string;
  template_id: string;
  template_name: string;
  type: ChecklistType;
  run_date: string;
  items: ChecklistRunItemRow[];
  status: ChecklistRunStatus;
  started_by: string | null;
  started_by_name?: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type IncidentCategory = 'equipment' | 'patient_safety' | 'complaint' | 'security' | 'other';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface Incident {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reported_by: string | null;
  reported_by_name?: string | null;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  resolution_notes: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}
