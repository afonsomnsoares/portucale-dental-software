'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, GhostBtn, PageHeader, PrimaryBtn, Sel, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
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

// ─── Uma só matriz de permissões, dois âmbitos ──────────────────────────────
// Eram duas cópias com 170 de 195 linhas iguais, separadas por uma diferença
// real: quem tem clínica própria não pode pedir GET /api/tenants (o servidor
// responde 403), por isso a versão de plataforma não servia para a clínica tal
// como estava. Aqui a distinção está num sítio só — `ownTenantId` — em vez de
// justificar um ficheiro inteiro.
//
// Quem manda continua a ser o servidor: app/api/permissions/route.ts força
// user.tenantId a quem não é super-admin, e o PUT recusa um tenantId que não
// corresponda. Isto aqui é a interface a não prometer o que não pode cumprir.
export default function PermissionsMatrix() {
  const { api, user } = useAuth();
  // Um admin de clínica tem a sua; o super-admin não tem nenhuma e escolhe-a.
  const ownTenantId = user?.tenantId || '';
  // Só o super-admin (sem clínica própria) precisa de escolher; para os outros
  // o hook fica em espera e não pede nada.
  const tenantsQuery = useQuery<Tenant[]>(ownTenantId ? null : '/tenants');
  const tenants = tenantsQuery.data ?? [];
  const [tenantId, setTenantId] = useState(ownTenantId);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<PermissionData | null>(null);
  const [err, setErr] = useState('');
  const [changes, setChanges] = useState<ChangeEntry[]>([]);

  useEffect(() => {
    // Só quem não tem clínica própria precisa da lista — e é o único a quem o
    // servidor a dá.
    if (!tenantId && tenants.length) setTenantId(tenants[0].id);
  }, [tenantId, tenants]);

  useEffect(() => {
    // Sem clínica escolhida não há matriz que faça sentido pedir — exceto para
    // quem tem a sua, que a omite e deixa o servidor forçá-la.
    if (!tenantId && !ownTenantId) return;
    setErr('');
    api(tenantId ? `/permissions?tenantId=${tenantId}` : '/permissions')
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Falha ao carregar'))
      .finally(() => setLoading(false));
    setChanges([]);
  }, [api, tenantId, ownTenantId]);

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
    if (!pendingCount) return;
    setSaving(true);
    setErr('');
    try {
      const res = await api('/permissions', {
        method: 'PUT',
        body: { tenantId: tenantId || undefined, updates: changes },
      });
      setData(res);
      setChanges([]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Falha ao guardar');
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    if (!data) return;
    const updates: ChangeEntry[] = [];
    for (const role of roles) for (const action of actions) updates.push({ role, action, allowed: null });
    setChanges(updates);
    api('/permissions', { method: 'PUT', body: { tenantId: tenantId || undefined, updates } })
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Falha ao repor'))
      .finally(() => setChanges([]));
  }

  return (
    <div>
      <PageHeader title="Matriz de Permissões" sub="O que cada papel pode fazer, por clínica">
        {!ownTenantId &&
          (loading ? (
            <Spinner />
          ) : (
            <Sel value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ maxWidth: 320 }}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Sel>
          ))}
        <GhostBtn onClick={resetAll} disabled={saving}>
          Repor omissões
        </GhostBtn>
        <PrimaryBtn onClick={save} disabled={!pendingCount || saving} style={{ justifyContent: 'center' }}>
          {saving ? 'A guardar…' : `Guardar (${pendingCount})`}
        </PrimaryBtn>
      </PageHeader>

      {err && (
        <div
          className="card p-4"
          style={{
            border: '1px solid var(--urgency-critical-border)',
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            fontWeight: 'var(--weight-bold)',
          }}
        >
          {err}
        </div>
      )}

      {!data ? (
        <div className="card p-5">
          {loading ? <Spinner /> : <div style={{ color: 'var(--text-muted)' }}>Sem matriz de permissões.</div>}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="overflow-x-auto">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th className="data-th">Ação</th>
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
                        fontSize: 'var(--text-xs)',
                        color: 'var(--text-primary)',
                        fontWeight: 'var(--weight-bold)',
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
                              {isOn ? 'Permitir' : 'Negar'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setOverride(role, action, null)}
                              disabled={saving || (!isOverride && pending === undefined)}
                              style={{ minWidth: 64, justifyContent: 'center', opacity: isOverride ? 1 : 0.35 }}
                            >
                              Omissão
                            </button>
                            {isPending ? (
                              <Badge label="Por guardar" bg="var(--urgency-soon-bg)" color="var(--urgency-soon)" />
                            ) : isOverride ? (
                              <Badge label="Alterado" bg="var(--accent-bg)" color="var(--accent)" />
                            ) : (
                              <Badge label="Omissão" bg="var(--bg-page)" color="var(--text-secondary)" />
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
