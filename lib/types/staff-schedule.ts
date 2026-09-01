export interface StaffShift {
  id: string;
  tenant_id: string;
  user_id: string;
  user_name?: string;
  role?: string;
  weekday: number;
  start_time: string;
  end_time: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type StaffTimeOffType = 'vacation' | 'sick' | 'other';
export type StaffTimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface StaffTimeOff {
  id: string;
  tenant_id: string;
  user_id: string;
  user_name?: string;
  type: StaffTimeOffType;
  start_date: string;
  end_date: string;
  status: StaffTimeOffStatus;
  notes: string;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamRosterEntry {
  userId: string;
  userName: string;
  role: string;
  todayShifts: Array<{ startTime: string; endTime: string }>;
  onLeaveToday: boolean;
  workingNow: boolean | null;
}
