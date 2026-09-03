'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, GhostBtn, PageHeader, PrimaryBtn, Sel, Spinner } from '@/components/ui';
import type { Tenant } from '@/lib/types';

interface PermEntry {
  default: boolean;
  override: boolean | null;
  effective: boolean;
}

interface PermissionData {
  tenantId: string;
  roles: string[];
  actions: string[];
  matrix: Record<string, Record<string, PermEntry>>;
}

interface ChangeEntry {
  role: string;
  action: string;
  allowed: boolean | null;
}

export default function PermissionsPage() {
  const { api } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<PermissionData | null>(null);
  const [err, setErr] = useState('');
  const [changes, setChanges] = useState<ChangeEntry[]>([]);

  useEffect(() => {
    api('/tenants')
      .then((t) => {
        setTenants(t || []);
        if ((t || []).length) setTenantId(t[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => {
    if (!tenantId) return;
    setErr('');
    api(`/permissions?tenantId=${tenantId}`)
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => {});
    setChanges([]);
  }, [api, tenantId]);

  const actions = data?.actions || [];
  const roles = data?.roles || [];

  const pendingCount = changes.length;

  function setOverride(role: string, action: string, allowed: boolean | null) {
    setChanges((prev) => {
      const rest = (prev || []).filter((x) => !(x.role === role && x.action === action));
      return [...rest, { role, action, allowed }];
    });
  }

  const changeMap = useMemo(() => {
    return new Map((changes || []).map((x) => [`${x.role}:${x.action}`, x.allowed]));
  }, [changes]);

  async function save() {
    if (!tenantId || !pendingCount) return;
    setSaving(true);
    setErr('');
    try {
      const res = await api('/permissions', { method: 'PUT', body: { tenantId, updates: changes } });
      setData(res);
      setChanges([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    if (!data) return;
    const updates: ChangeEntry[] = [];
    for (const role of roles) for (const action of actions) updates.push({ role, action, allowed: null });
    setChanges(updates);
    api('/permissions', { method: 'PUT', body: { tenantId, updates } })
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed to reset'))
      .finally(() => setChanges([]));
  }

  return (
    <div>
      <PageHeader title="Permissions Matrix" sub="Configure role actions per tenant">
        {loading ? (
          <Spinner />
        ) : (
          <Sel value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ maxWidth: 320 }}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Sel>
        )}
        <GhostBtn onClick={resetAll} disabled={!tenantId || saving}>
          Reset Overrides
        </GhostBtn>
        <PrimaryBtn onClick={save} disabled={!pendingCount || saving} style={{ justifyContent: 'center' }}>
          {saving ? 'Saving…' : `Save (${pendingCount})`}
        </PrimaryBtn>
      </PageHeader>

      {err && (
        <div
          className="card p-4"
          style={{ border: '1px solid #FFBDAD', background: '#FFEBE6', color: '#DE350B', fontWeight: 700 }}
        >
          {err}
        </div>
      )}

      {!data ? (
        <div className="card p-5">
          {loading ? <Spinner /> : <div style={{ color: '#97A0AF' }}>Select a tenant.</div>}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="data-th">Action</th>
                  {roles.map((r) => (
                    <th key={r} className="data-th" style={{ textTransform: 'capitalize' }}>
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr key={action}>
                    <td
                      className="data-td"
                      style={{
                        fontFamily: '"JetBrains Mono",monospace',
                        fontSize: 12,
                        color: '#172B4D',
                        fontWeight: 700,
                      }}
                    >
                      {action}
                    </td>
                    {roles.map((role) => {
                      const cell = data.matrix?.[role]?.[action];
                      const pending = changeMap.get(`${role}:${action}`);
                      const effective =
                        pending === undefined ? cell?.effective : pending === null ? cell?.default : !!pending;
                      const isOn = !!effective;
                      const isOverride = pending === undefined ? cell?.override !== null : pending !== null;
                      const isPending = pending !== undefined;
                      return (
                        <td key={`${role}:${action}`} className="data-td">
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button
                              type="button"
                              className={`btn btn-sm ${isOn ? 'btn-primary' : 'btn-secondary'}`}
                              onClick={() => setOverride(role, action, !isOn)}
                              disabled={saving}
                              style={{ minWidth: 74, justifyContent: 'center' }}
                            >
                              {isOn ? 'Allow' : 'Deny'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setOverride(role, action, null)}
                              disabled={saving || (!isOverride && pending === undefined)}
                              style={{ minWidth: 64, justifyContent: 'center', opacity: isOverride ? 1 : 0.35 }}
                            >
                              Default
                            </button>
                            {isPending ? (
                              <Badge label="Pending" bg="#FFF7E6" color="#FF8B00" />
                            ) : isOverride ? (
                              <Badge label="Override" bg="#DEEBFF" color="#0052CC" />
                            ) : (
                              <Badge label="Default" bg="#F4F7FA" color="#5E6C84" />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
