import Health from '@/components/super-admin/pages/Health';
import { platformHealth } from '@/lib/platformStats';
import { requirePage } from '@/lib/serverPage';

// `platform: true` — sem ação associada, como a rota: o estado do sistema é do
// operador da plataforma e de mais ninguém.
export default async function Page() {
  await requirePage({ platform: true, tenant: 'optional' });
  const estado = await platformHealth();
  return <Health initialData={estado} />;
}
