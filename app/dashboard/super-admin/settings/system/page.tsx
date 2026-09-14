import SystemConfig from '@/components/super-admin/pages/SystemConfig';
import { systemConfig } from '@/lib/platformStats';
import { requirePage } from '@/lib/serverPage';

// Mesmo porteiro da rota e da página de estado do sistema: `platform: true`, sem
// ação. Ler no servidor evita o salto cliente→API para a primeira pintura, e o
// componente continua a saber refazer a leitura sozinho.
export default async function Page() {
  await requirePage({ platform: true, tenant: 'optional' });
  const config = await systemConfig();
  return <SystemConfig initialData={config} />;
}
