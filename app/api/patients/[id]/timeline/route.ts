import type { NextRequest } from 'next/server';
import { getAuth, unauthorized } from '@/lib/auth';
import { query } from '@/lib/db';
import { revalidateSession } from '@/lib/permissions';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuth(request);
  if (!user) return unauthorized();
  // A sessão pode ter sido desativada, despromovida ou movida de clínica depois de o
  // token ser assinado; revalidateSession() confirma-o contra `users` e realinha
  // user.role/user.tenantId. Ver lib/permissions.ts.
  if (!(await revalidateSession(user))) return unauthorized();
  const { id } = await params;
  const tenantId = user.tenantId;
  const rows = await query(
    `SELECT pt.* FROM patient_timeline pt
     JOIN patients p ON p.id = pt.patient_id
     WHERE pt.patient_id=$1 AND ($2::uuid IS NULL OR p.tenant_id=$2::uuid)
     ORDER BY pt.created_at DESC`,
    [id, tenantId],
  );
  return Response.json(rows);
}
