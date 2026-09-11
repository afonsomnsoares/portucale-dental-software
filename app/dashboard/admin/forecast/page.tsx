import Forecast from '@/components/clinic/pages/Forecast';
import { clampHorizon, computeForecasts, DEFAULT_HORIZON_DAYS } from '@/lib/forecast';
import { requirePage } from '@/lib/serverPage';

// Server Component: lê a previsão de arranque da base de dados e entrega-a já
// pronta, em vez de mandar o browser pedi-la depois de hidratar.
//
// A mesma ação que a rota exige — prever é ler o negócio (ver o cabeçalho de
// app/api/forecast/route.ts). O `requirePage` é o que garante que isso não se
// perde ao deixar de haver uma rota pelo meio.
//
// A rota continua a existir: é ela que serve as mudanças de horizonte, que são
// interação e não valem uma ida ao servidor inteira.
export default async function Page() {
  const { tenantId } = await requirePage({ permission: 'reports:read' });
  const inicial = await computeForecasts(tenantId, clampHorizon(DEFAULT_HORIZON_DAYS));
  return <Forecast initialData={inicial} initialDays={String(DEFAULT_HORIZON_DAYS)} />;
}
