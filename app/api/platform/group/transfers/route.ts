import { appendAudit } from '@/lib/audit';
import { setTransferPolicy } from '@/lib/group';
import { withRoute } from '@/lib/route';

// ─── A porta legal ──────────────────────────────────────────────────────────
// Ligar isto é declarar que existe base para comunicar dados de um doente entre duas
// unidades e contactá-lo em nome de uma com que ele nunca falou. Não é uma preferência
// de ecrã, e por isso pede a base por escrito: um campo vazio é recusado.
//
// O que fica guardado — quem ligou, quando, e com que fundamento — não é burocracia: é
// a única resposta possível a «com que base fizeram isto?» seis meses depois.
export const PUT = withRoute({ platform: 'tenants:manage', tenant: 'optional' }, async ({ request, user }) => {
  const body = await request.json().catch(() => null);
  const tenantId = String(body?.tenantId || '');
  const enabled = body?.enabled === true;
  const basis = String(body?.basis || '').trim();

  if (!tenantId) return Response.json({ error: 'tenantId é obrigatório' }, { status: 400 });
  if (enabled && basis.length < 10) {
    return Response.json(
      { error: 'Para ligar as transferências é preciso declarar a base legal por escrito.' },
      { status: 400 },
    );
  }

  const row = await setTransferPolicy(tenantId, enabled, basis, user.id || null);
  if (!row) return Response.json({ error: 'Clínica não encontrada' }, { status: 404 });

  await appendAudit(
    user,
    'UPDATE',
    `Transferências de grupo — ${row.name}`,
    enabled ? 'desligadas' : 'ligadas',
    enabled ? `ligadas (${basis.slice(0, 120)})` : 'desligadas',
    user.clinic,
  );
  return Response.json({ tenantId, enabled: !!row.group_transfers_enabled, basis: row.group_transfers_basis });
});
