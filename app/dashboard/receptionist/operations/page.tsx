'use client';
import { useAuth } from '@/app/providers';
import ChecklistPanel from '@/components/operations/ChecklistPanel';
import IncidentsPanel from '@/components/operations/IncidentsPanel';
import { PageHeader } from '@/components/ui';

export default function ReceptionistOperationsPage() {
  const { api } = useAuth();
  return (
    <div>
      <PageHeader title="Operações da Clínica" sub="Checklists de hoje e incidentes" />
      <div className="section-label mb-3">CHECKLISTS DE HOJE</div>
      <div className="mb-6">
        <ChecklistPanel api={api} />
      </div>
      <IncidentsPanel api={api} canManage={false} />
    </div>
  );
}
