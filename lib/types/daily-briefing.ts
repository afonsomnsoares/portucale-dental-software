import type { MissingField } from '../missingData';
import type { NextAction } from '../nextAction';

export interface DailyBriefingRow {
  appointmentId: string;
  appointmentStatus: string;
  startTime: string;
  patientId: string;
  patientName: string;
  missingFields: MissingField[];
  openTaskCount: number;
  hasUpcomingAppointment: boolean;
  nextAction: NextAction;
}

export interface DailyBriefingData {
  date: string;
  rows: DailyBriefingRow[];
}
