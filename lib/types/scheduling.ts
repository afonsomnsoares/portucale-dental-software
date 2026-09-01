// AppointmentTypeOption lives in lib/constants.ts, not here, alongside
// APPOINTMENT_TYPES/getDefaultDuration — see the comment in lib/scheduling.ts
// for why (this barrel is fine for either server or client code, but the
// type list needs to be reachable from 'use client' components without also
// pulling in lib/scheduling.ts's server-only `query()` import).

export interface SuggestedSlot {
  dentistId: string;
  dentistName: string;
  chair: number;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
}

export interface SuggestSlotsResult {
  duration: number;
  slots: SuggestedSlot[];
  // Non-fatal notes about the suggestion, e.g. "no dentist has the required specialty,
  // showing all dentists instead" — see lib/scheduling.ts's suggestAppointmentSlots.
  warnings: string[];
}
