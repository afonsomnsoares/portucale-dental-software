import type { HandoffSignals, ShiftLabel } from '../shiftHandoffCalc';

export type { HandoffSignals, ShiftLabel };

export type ShiftHandoffStatus = 'open' | 'acknowledged';

export interface ShiftHandoff {
  id: string;
  tenant_id: string;
  handoff_date: string;
  shift_label: ShiftLabel;
  from_user_id: string;
  from_user_name?: string | null;
  // null = deixada em aberto para quem entrar a seguir, não "sem destinatário"
  // (ver 031_task_routing_handoffs.sql).
  to_user_id: string | null;
  to_user_name?: string | null;
  notes: string;
  items: string[];
  status: ShiftHandoffStatus;
  acknowledged_by: string | null;
  acknowledged_by_name?: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShiftHandoffDraft {
  date: string;
  shiftLabel: ShiftLabel;
  items: string[];
  signals: HandoffSignals;
}
