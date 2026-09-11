import { notFound } from 'next/navigation';
import ClinicRecoveryPage from '@/components/clinic/pages/Recovery';
import { buildRecoveryPayload } from '@/lib/recovery';
import { requirePage } from '@/lib/serverPage';

// A recuperação varre a carteira inteira à procura de receita por cobrar — é
// das leituras mais pesadas da aplicação, e por isso das que mais ganham em
// acontecer antes de a página chegar ao browser.
export default async function Page() {
  const { tenantId } = await requirePage({ permission: 'recovery:read' });
  const inicial = await buildRecoveryPayload(tenantId);
  if (!inicial) notFound();
  return <ClinicRecoveryPage initialData={inicial} />;
}
