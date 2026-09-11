import { badRequest } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { DEFAULT_SUGGEST_DAYS, DEFAULT_SUGGEST_LIMIT, suggestAppointmentSlots } from '@/lib/scheduling';
import { asDate, asInt } from '@/lib/validate';

// Read-only precursor to POST /api/appointments — same permission as actually
// creating one (appointments:create), since suggesting a slot only matters
// as a step toward booking it, not a capability of its own. Never writes
// anything; the receptionist still confirms by calling POST /api/appointments,
// which independently re-checks the slot is still free (see that route).
export const GET = withRoute(
  { permission: 'appointments:create', tenant: 'required' },
  async ({ request, tenantId }) => {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    if (!type) return badRequest('type is required');

    const fromDateRaw = searchParams.get('fromDate');
    const fromDate = fromDateRaw ? asDate(fromDateRaw) : new Date().toISOString().slice(0, 10);
    if (fromDateRaw && !fromDate) return badRequest('fromDate must be a valid date');

    const days = asInt(searchParams.get('days'), { min: 1, max: 30 }) ?? DEFAULT_SUGGEST_DAYS;
    const limit = asInt(searchParams.get('limit'), { min: 1, max: 20 }) ?? DEFAULT_SUGGEST_LIMIT;
    const duration = asInt(searchParams.get('duration'), { min: 5, max: 480 }) ?? undefined;
    const preferredDentistId = searchParams.get('dentistId') || undefined;
    const patientId = searchParams.get('patientId') || undefined;

    const result = await suggestAppointmentSlots({
      tenantId,
      type,
      duration,
      patientId,
      preferredDentistId,
      fromDate: fromDate || undefined,
      days,
      limit,
    });
    return Response.json(result);
  },
);
