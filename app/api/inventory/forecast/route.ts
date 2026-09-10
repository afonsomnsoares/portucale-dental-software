import { computeInventoryOverview, computeProcedureDemandForecast } from '@/lib/inventory';
import { withRoute } from '@/lib/route';

// Read model for the "Previsão & Validade" tab. `overview`: current stock + consumption
// rate + days-until-stockout + at-risk flag + open batches with expiry status (see
// lib/inventory.ts's computeInventoryOverview) — a projection from past consumption.
// `procedureDemand`: what the *schedule itself* says will be needed in the next 14 days
// (see computeProcedureDemandForecast) — item 13's "precisamos de X unidades para os
// procedimentos previstos" example. Complementary, not a replacement for one another.
export const GET = withRoute({ permission: 'inventory:manage', tenant: 'resolved' }, async ({ tenantId }) => {
  const [overview, procedureDemand] = await Promise.all([
    computeInventoryOverview(tenantId),
    computeProcedureDemandForecast(tenantId),
  ]);
  return Response.json({ overview, procedureDemand });
});
