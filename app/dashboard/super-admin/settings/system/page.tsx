import Configuracao from '@/components/super-admin/pages/Configuracao';
import { systemConfig } from '@/lib/platformStats';
import { requirePage } from '@/lib/serverPage';

// Mesmo porteiro da rota e da página de estado do sistema: `platform: true`, sem ação.
// Ler no servidor evita o salto cliente→API para a primeira pintura, e o componente
// continua a saber refazer a leitura sozinho.
//
// A leitura fica porque «Sistema» é o separador de entrada — é o que se pinta primeiro.
// O separador dos campos de registo pede os seus dados quando for aberto.
export default async function Page() {
  await requirePage({ platform: true, tenant: 'optional' });
  const config = await systemConfig();
  return <Configuracao initialConfig={config} />;
}
