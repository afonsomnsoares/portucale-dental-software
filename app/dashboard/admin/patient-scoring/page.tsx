import PatientScoring from '@/components/clinic/pages/PatientScoring';
import { computeTenantScores } from '@/lib/patientScoring';
import { requirePage } from '@/lib/serverPage';

// Os scores são recalculados a cada visita — não há nada guardado (ver o
// subtítulo do ecrã). Calculá-los no servidor poupa a ida ao /api e o intervalo
// em que a página existe vazia à espera dela.
//
// 'lifecycle:read', a mesma ação de app/api/patient-scoring/route.ts.
export default async function Page() {
  const { tenantId } = await requirePage({ permission: 'lifecycle:read' });
  const patients = await computeTenantScores(tenantId, 200);
  return <PatientScoring initialData={{ patients }} />;
}
