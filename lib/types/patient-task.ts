export type PatientTaskType = 'generic' | 'call' | 'document_request' | 'follow_up' | 'data_missing';
export type PatientTaskStatus = 'pending' | 'done' | 'cancelled';

export interface PatientTask {
  id: string;
  tenant_id: string;
  patient_id: string | null;
  patient_name?: string | null;
  type: PatientTaskType;
  title: string;
  notes: string;
  due_at: string | null;
  status: PatientTaskStatus;
  assigned_to: string | null;
  assigned_to_name?: string | null;
  // True quando foi lib/taskRouting.ts a escolher o destinatário, não uma pessoa
  // (ver 031_task_routing_handoffs.sql). Reatribuir à mão volta a pôr false.
  auto_assigned: boolean;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
