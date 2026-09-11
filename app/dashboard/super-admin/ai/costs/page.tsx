import AiCosts from '@/components/super-admin/pages/AiCosts';
import { aiUsage } from '@/lib/aiUsage';
import { requirePage } from '@/lib/serverPage';

// `platform: 'agents:read'`, a mesma da rota: o consumo de IA é de toda a rede,
// e vê-se de fora de qualquer clínica.
export default async function Page() {
  await requirePage({ platform: 'agents:read', tenant: 'optional' });
  const consumo = await aiUsage();
  return <AiCosts initialData={consumo} />;
}
