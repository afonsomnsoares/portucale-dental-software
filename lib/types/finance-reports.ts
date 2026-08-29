export interface FinanceDentistRevenue {
  dentist_name: string;
  invoice_count: number;
  total_amount: number;
  total_paid: number;
}

export interface FinanceDailyRevenue {
  day: string;
  invoices: number;
  revenue: number;
}

export interface FinanceRecentPayment {
  id: string;
  patient_name: string | null;
  paid: number;
  amount: number;
  status: string;
  method: string;
  invoice_date: string;
  updated_at: string;
}

export interface FinanceData {
  totals?: { total_paid?: number; total_invoices?: number; total_outstanding?: number; total_amount?: number };
  patientBalance?: number;
  statusCounts?: Array<{ status: string; count: number; amount: number }>;
  byDentist?: FinanceDentistRevenue[];
  dailyRevenue?: FinanceDailyRevenue[];
  recentPayments?: FinanceRecentPayment[];
}

export interface ReportSummary {
  tenant: { id: string; name: string; operatories: number };
  range: { from: string; to: string };
  metrics: {
    appointmentsTotal: number;
    noShows: number;
    noShowRate: number;
    treatmentsTotal: number;
    treatmentsCompleted: number;
    conversionRate: number;
    completedValue: number;
    chairMinutes: number;
    chairUtilization: number;
    newPatients: number;
    presentedValue: number;
    acceptedValue: number;
    planConversionRate: number;
    outstandingBalance: number;
    recoveryPotential: number;
  };
  previous: {
    range: { from: string; to: string };
    revenueTrend: number | null;
    noShowTrend: number | null;
    conversionTrend: number | null;
  };
  dailyRevenue: Array<{ day: string; revenue: number }>;
}

export interface ClinicComparisonRow {
  tenantId: string;
  name: string;
  revenue: number;
  presentedValue: number;
  acceptedValue: number;
  conversionRate: number;
  noShowRate: number;
  chairUtilization: number;
}

export interface ClinicComparison {
  range: { from: string; to: string };
  clinics: ClinicComparisonRow[];
  gap: { bestTenantId: string; worstTenantId: string; valueDiff: number } | null;
}

export interface ReportInsight {
  insight: string | null;
  configured: boolean;
  error?: string;
}
