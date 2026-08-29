import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { appendAudit } from '@/lib/audit';
import { getAuth, requireSameOrigin } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  const cookieStore = await cookies();
  cookieStore.delete('dent_token');
  if (user) {
    await appendAudit(
      { name: user.name, role: user.role, clinic: user.clinic },
      'AUTH',
      `Logout: ${user.id}`,
      null,
      'success',
      user.clinic,
    );
  }
  return Response.json({ success: true });
}
