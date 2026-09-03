'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import ChecklistPanel from '@/components/operations/ChecklistPanel';
import IncidentsPanel from '@/components/operations/IncidentsPanel';
import TemplateManager from '@/components/operations/TemplateManager';
import { PageHeader, Sel, Spinner, Tabs } from '@/components/ui';
import type { DbUser, Tenant } from '@/lib/types';

export default function AdminOperationsPage() {
  const { api, user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [tab, setTab] = useState('checklists');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [teamUsers, setTeamUsers] = useState<DbUser[]>([]);
  const [loading, setLoading] = useState(isSuperAdmin);

  useEffect(() => {
    if (isSuperAdmin) {
      api('/tenants')
        .then((rows) => {
          setTenants(rows || []);
          if ((rows || []).length) setTenantId(rows[0].id);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [api, isSuperAdmin]);

  useEffect(() => {
    if (isSuperAdmin && !tenantId) return;
    // /api/users ignores ?tenantId= for a super_admin (it always returns every tenant's
    // staff, see app/api/users/route.ts) — filter client-side to the selected clinic.
    api('/users')
      .then((rows: DbUser[]) => setTeamUsers(isSuperAdmin ? rows.filter((u) => u.tenant_id === tenantId) : rows || []))
      .catch(() => {});
  }, [api, isSuperAdmin, tenantId]);

  if (loading) return <Spinner />;

  const effectiveTenantId = isSuperAdmin ? tenantId : undefined;

  return (
    <div>
      <PageHeader title="Operações da Clínica" sub="Checklists de abertura/fecho e escalamento de incidentes">
        {isSuperAdmin && (
          <Sel value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ maxWidth: 260 }}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Sel>
        )}
      </PageHeader>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'checklists', label: 'Checklists' },
          { key: 'incidents', label: 'Incidentes' },
        ]}
      />

      {isSuperAdmin && !tenantId ? (
        <div className="card p-5 text-sm" style={{ color: 'var(--ink-3)' }}>
          Sem clínicas.
        </div>
      ) : tab === 'checklists' ? (
        <div>
          <div className="card p-5 mb-5">
            <TemplateManager api={api} tenantId={effectiveTenantId} />
          </div>
          <div className="section-label mb-3">CHECKLISTS DE HOJE</div>
          <ChecklistPanel api={api} tenantId={effectiveTenantId} />
        </div>
      ) : (
        <IncidentsPanel api={api} canManage tenantId={effectiveTenantId} teamUsers={teamUsers} />
      )}
    </div>
  );
}
