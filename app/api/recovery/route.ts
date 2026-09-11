import { buildRecoveryPayload } from '@/lib/recovery';
import { withRoute } from '@/lib/route';

export const GET = withRoute({ permission: 'recovery:read', tenant: 'required' }, async ({ tenantId }) => {
  const payload = await buildRecoveryPayload(tenantId);
  if (!payload) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(payload);
});
