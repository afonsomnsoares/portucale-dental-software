'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, PageHeader, Spinner } from '@/components/ui';
import type { AuditLogEntry } from '@/lib/types';

const AM: Record<string, { bg: string; color: string }> = {
  UPDATE: { bg: '#FFF7E6', color: '#FF8B00' },
  CREATE: { bg: '#E3FCEF', color: '#00875A' },
  DELETE: { bg: '#FFEBE6', color: '#DE350B' },
  PROVISION: { bg: '#EAE6FF', color: '#5243AA' },
};
const RM: Record<string, { bg: string; color: string }> = {
  dentist: { bg: '#DEEBFF', color: '#0052CC' },
  receptionist: { bg: '#E6FCFF', color: '#00A3BF' },
  admin: { bg: '#EAE6FF', color: '#5243AA' },
};

// Registo de auditoria da própria clínica. app/api/audit/route.ts força o `clinic` de
// quem chama quando tem tenantId, por isso o que muda face à versão de plataforma
// (components/super-admin/pages/Audit.tsx) é só o texto: aqui não são "todos os tenants".
export default function ClinicAuditPage() {
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
      <PageHeader title="Auditoria" sub="Registo de atividade desta clínica — imutável, com hash SHA-256" />
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
        <div style={{ fontSize: 12, color: '#97A0AF', display: 'flex', alignItems: 'center' }}>
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
                    background: open ? '#F4F7FA' : 'white',
                    borderBottom: '1px solid #F4F7FA',
                    transition: 'background 0.1s',
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: '#97A0AF',
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
                      color: '#172B4D',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {l.resource}
                  </div>
                  <Badge label={l.user_role} bg={rm.bg} color={rm.color} />
                  <div style={{ fontSize: 12, color: '#5E6C84', minWidth: 100 }}>{l.user_name}</div>
                  <div
                    style={{ fontSize: 10, color: '#C1C7D0', fontFamily: '"JetBrains Mono",monospace', minWidth: 90 }}
                  >
                    #{l.hash}
                  </div>
                  <div style={{ color: '#97A0AF', fontSize: 12 }}>{open ? '▲' : '▼'}</div>
                </button>
                {open && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 12,
                      padding: '16px 20px',
                      background: '#F4F7FA',
                      borderBottom: '1px solid #DFE1E6',
                    }}
                  >
                    {(
                      [
                        ['ANTES', l.before_val, '#DE350B'],
                        ['DEPOIS', l.after_val, '#00875A'],
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
                            border: '1px solid #DFE1E6',
                            borderRadius: 6,
                            padding: '12px 14px',
                            fontSize: 12,
                            fontFamily: '"JetBrains Mono",monospace',
                            color: '#172B4D',
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
