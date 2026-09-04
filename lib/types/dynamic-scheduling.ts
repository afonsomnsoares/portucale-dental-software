// Espelho, do lado do cliente, do que lib/dynamicScheduling.ts devolve.
//
// Existe em vez de um import direto porque esse módulo importa `query()` (e por
// isso `pg`), o que o torna inseguro para um componente 'use client' — a mesma
// razão pela qual APPOINTMENT_TYPES vive em lib/constants.ts e não em
// lib/scheduling.ts.

import type { DemandSource } from './scheduling-demand';

export type { DemandSource };

export interface PlanOfferView {
  candidateKey: string;
  source: DemandSource;
  sourceLabel: string;
  patientId: string;
  patientName: string;
  phone: string | null;
  canSms: boolean;
  treatmentType: string;
  durationMinutes: number;
  /** 0-100, ver DEMAND_WEIGHTS em lib/demandPoolCalc.ts. */
  score: number;
  reason: string;
  valueEur: number;
  noShowRiskPct: number;
  dentistId: string | null;
  dentistName: string | null;
  startTime: string;
  preferenceViolations: string[];
  advanceFrom: { appointmentId: string; date: string } | null;
}

export interface PlanSlotView {
  key: string;
  chair: number;
  date: string;
  startTime: string;
  endTime: string;
  freeMinutes: number;
  kind: 'gap' | 'edge';
  agentNote?: string;
  offers: PlanOfferView[];
}

export interface WithheldView {
  patientName: string;
  sourceLabel: string;
  date: string;
  startTime: string;
  reason: string;
}

export type SchedulingMode = 'off' | 'propose' | 'contact' | 'autobook';

export interface SchedulingPolicyView {
  mode: SchedulingMode;
  maxOffersPerSlot: number;
  dailyContactCap: number;
  quietHoursStart: number;
  quietHoursEnd: number;
  minScore: number;
  allowedSources: string[];
  horizonDays: number;
  offerExpiryHours: number;
  patientCooldownDays: number;
}

export interface DynamicPlan {
  generatedAt: string;
  policy: SchedulingPolicyView;
  autonomy: { computes: boolean; contacts: boolean; autoBooks: boolean; quietNow: boolean };
  slots: PlanSlotView[];
  withheld: WithheldView[];
  counts: Record<DemandSource, number>;
  totals: {
    openings: number;
    candidates: number;
    plannedOffers: number;
    contactableOffers: number;
    fillableMinutes: number;
    estimatedValueEur: number;
  };
  remainingContactBudget: number;
  warnings: string[];
}

export interface DynamicRunResult {
  mode: SchedulingMode;
  decidedBy: 'ai' | 'deterministic' | 'none';
  offersSent: number;
  slotsTouched: number;
  skipped: string | null;
  plan: DynamicPlan;
}
