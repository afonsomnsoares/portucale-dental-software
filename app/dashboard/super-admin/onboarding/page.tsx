import Onboarding from '@/components/super-admin/pages/Onboarding';
import { tenantUsage } from '@/lib/platformStats';
import { requirePage } from '@/lib/serverPage';

// A mesma leitura que /api/platform/usage serve, feita aqui — e com o mesmo
// porteiro: `platform`, não `permission`. Esta página lê TODAS as clínicas, e
// `platform` é o que exige ser super-admin a par da ação.
export default async function Page() {
  await requirePage({ platform: 'reports:read', tenant: 'optional' });
  const linhas = await tenantUsage();
  return <Onboarding initialData={linhas} />;
}
