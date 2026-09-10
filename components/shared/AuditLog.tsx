'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, PageHeader, Spinner } from '@/components/ui';
import type { AuditLogEntry } from '@/lib/types';

const AM: Record<string, { bg: string; color: string }> = {
  UPDATE: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  CREATE: { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  DELETE: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  PROVISION: { bg: 'var(--cat-purple-bg)', color: 'var(--cat-purple)' },
};
const RM: Record<string, { bg: string; color: string }> = {
  dentist: { bg: 'var(--accent-bg)', color: 'var(--accent)' },
  receptionist: { bg: 'var(--cat-teal-bg)', color: 'var(--cat-teal)' },
  admin: { bg: 'var(--cat-purple-bg)', color: 'var(--cat-purple)' },
};

// ─── Um só registo de auditoria, dois âmbitos ───────────────────────────────
// Existiam duas cópias deste ecrã — components/clinic/pages/Audit.tsx e
// components/super-admin/pages/Audit.tsx — com 171 de 182 linhas iguais. O que
// as separava eram três coisas, e nenhuma justificava um segundo ficheiro: o
// subtítulo, uma coluna com o nome da clínica, e o facto de a versão de
// plataforma nunca ter sido traduzida.
//
// Quem filtra é o servidor: app/api/audit/route.ts força o `clinic` de quem chama
// quando essa pessoa tem tenantId, e só um super-admin vê várias clínicas. Aqui
// `scope` decide apenas o que faz sentido MOSTRAR — numa clínica só, a coluna da
// clínica seria a mesma palavra repetida em todas as linhas.
export type AuditScope = 'clinic' | 'platform';

export default function AuditLog({ scope }: { scope: AuditScope }) {
  const { api } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | number | null>(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams();
    if (action) p.set('action', action);
    if (search) p.set('q', search);
    const d = await api(`/audit?${p}`).catch(() => []);
    setLogs(d || []);
    setLoading(false);
  }, [api, action, search]);
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div>
      <PageHeader
        title="Auditoria"
        sub={
          scope === 'platform'
            ? 'Registo de atividade de todas as clínicas — imutável, com hash SHA-256'
            : 'Registo de atividade desta clínica — imutável, com hash SHA-256'
        }
      />
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder="Procurar utilizadores, recursos…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" style={{ maxWidth: 180 }} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">Todas as ações</option>
          {['UPDATE', 'CREATE', 'DELETE', 'PROVISION'].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
          {logs.length} {logs.length === 1 ? 'entrada' : 'entradas'}
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Spinner />
        ) : (
          logs.map((l) => {
            const am = AM[l.action] || AM.UPDATE;
            const rm = RM[l.user_role] || RM.admin;
            const open = expanded === l.id;
            return (
              <div key={l.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : l.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setExpanded(open ? null : l.id);
                  }}
                  style={{
                    display: 'flex',
                    width: '100%',
                    border: 'none',
                    font: 'inherit',
                    textAlign: 'left',
                    gap: 14,
                    alignItems: 'center',
                    padding: '13px 20px',
                    cursor: 'pointer',
                    background: open ? 'var(--bg-page)' : 'white',
                    borderBottom: '1px solid var(--bg-page)',
                    transition: 'background 0.1s',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      minWidth: 148,
                      fontFamily: '"JetBrains Mono",monospace',
                    }}
                  >
                    {new Date(l.created_at).toLocaleString('pt-PT')}
                  </div>
                  <Badge label={l.action} bg={am.bg} color={am.color} />
                  <div
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {l.resource}
                  </div>
                  <Badge label={l.user_role} bg={rm.bg} color={rm.color} />
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 100 }}>{l.user_name}</div>
                  {scope === 'platform' && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 72 }}>{l.clinic}</div>
                  )}
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      fontFamily: '"JetBrains Mono",monospace',
                      minWidth: 90,
                    }}
                  >
                    #{l.hash}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</div>
                </button>
                {open && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                      padding: '16px 20px',
                      background: 'var(--bg-page)',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    {(
                      [
                        ['ANTES', l.before_val, 'var(--urgency-critical)'],
                        ['DEPOIS', l.after_val, 'var(--urgency-ok)'],
                      ] as Array<[string, string | null, string]>
                    ).map(([lbl, val, col]) => (
                      <div key={lbl}>
                        <div
                          style={{ fontSize: 10, fontWeight: 700, color: col, letterSpacing: '.1em', marginBottom: 8 }}
                        >
                          {lbl}
                        </div>
                        <div
                          style={{
                            background: 'white',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius-control)',
                            padding: '12px 14px',
                            fontSize: 12,
                            fontFamily: '"JetBrains Mono",monospace',
                            color: 'var(--text-primary)',
                            minHeight: 44,
                          }}
                        >
                          {val ?? '—'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
