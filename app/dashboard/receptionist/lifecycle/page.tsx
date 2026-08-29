'use client';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, GhostBtn, PageHeader, Spinner } from '@/components/ui';
import { formatPhonePT } from '@/lib/constants';
import type { Lead, LifecycleData, LifecyclePatient, LifecycleStageKey } from '@/lib/types';

const STAGE_COLOR: Record<LifecycleStageKey, string> = {
  new: 'var(--brand)',
  in_treatment: 'var(--teal)',
  stable: 'var(--green)',
  inactive: 'var(--red)',
};

function PatientCard({ p, meta }: { p: LifecyclePatient; meta: string }) {
  return (
    <div className="card p-3 mb-2" style={{ boxShadow: 'none', border: '1px solid var(--border)' }}>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
      <div className="text-xs mt-1" style={{ color: 'var(--ink-2)' }}>
        {p.phone ? <a href={`tel:${p.phone}`}>{formatPhonePT(p.phone)}</a> : '—'}
      </div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
        {meta}
      </div>
    </div>
  );
}

function Column({
  title,
  count,
  color,
  description,
  children,
}: {
  title: string;
  count: number;
  color: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div
      className="card p-3"
      style={{ minWidth: 260, maxWidth: 260, display: 'flex', flexDirection: 'column', flexShrink: 0 }}
    >
      <div
        className="flex items-center justify-between mb-1"
        style={{ borderTop: `3px solid ${color}`, marginTop: -12, paddingTop: 10 }}
      >
        <span className="section-label">{title}</span>
        <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
          {count}
        </span>
      </div>
      <p className="text-xs mb-2" style={{ color: 'var(--ink-3)' }}>
        {description}
      </p>
      <div style={{ overflowY: 'auto', maxHeight: 560 }}>{children}</div>
    </div>
  );
}

export default function LifecycleReceptionistPage() {
  const { api } = useAuth();
  const [data, setData] = useState<LifecycleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr('');
    const res = await api('/lifecycle').catch((e) => {
      setErr(e instanceof Error ? e.message : 'Falha ao carregar');
      return null;
    });
    setData(res);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function updateLeadStatus(lead: Lead, status: 'converted' | 'lost') {
    setBusyId(lead.id);
    await api('/leads', { method: 'PATCH', body: { id: lead.id, status } }).catch(() => null);
    setBusyId(null);
    load();
  }

  return (
    <div>
      <PageHeader title="Ciclo de Vida do Paciente" sub="Onde está cada contacto na relação com a clínica">
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      {err && (
        <div
          className="card p-4 mb-4"
          style={{ border: '1px solid #FFBDAD', background: '#FFEBE6', color: '#DE350B', fontWeight: 700 }}
        >
          {err}
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : !data ? (
        <Empty message="Sem dados disponíveis." />
      ) : (
        <div className="flex gap-3" style={{ overflowX: 'auto', paddingBottom: 8 }}>
          <Column
            title="Leads"
            count={data.leads.length}
            color="var(--amber)"
            description="Primeiro contacto, ainda sem consulta marcada."
          >
            {data.leads.length === 0 ? (
              <Empty message="Sem leads abertos." />
            ) : (
              data.leads.map((lead) => (
                <div
                  key={lead.id}
                  className="card p-3 mb-2"
                  style={{ boxShadow: 'none', border: '1px solid var(--border)' }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{lead.name}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--ink-2)' }}>
                    {lead.phone ? <a href={`tel:${lead.phone}`}>{formatPhonePT(lead.phone)}</a> : lead.email || '—'}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
                    {lead.source ? `${lead.source} · ` : ''}
                    {String(lead.created_at).slice(0, 10)}
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <GhostBtn
                      disabled={busyId === lead.id}
                      onClick={() => updateLeadStatus(lead, 'converted')}
                      style={{ padding: '4px 8px', fontSize: 11 }}
                    >
                      {busyId === lead.id ? '…' : 'Marcação feita'}
                    </GhostBtn>
                    <GhostBtn
                      disabled={busyId === lead.id}
                      onClick={() => updateLeadStatus(lead, 'lost')}
                      style={{ padding: '4px 8px', fontSize: 11 }}
                    >
                      Fechar
                    </GhostBtn>
                  </div>
                </div>
              ))
            )}
          </Column>

          {data.stages.map((s) => (
            <Column key={s.key} title={s.label} count={s.count} color={STAGE_COLOR[s.key]} description={s.description}>
              {s.patients.length === 0 ? (
                <Empty message="Sem pacientes." />
              ) : (
                s.patients.map((p) => (
                  <PatientCard
                    key={p.id}
                    p={p}
                    meta={
                      p.last_visit
                        ? `Última visita: ${String(p.last_visit).slice(0, 10)}`
                        : `Registado: ${String(p.created_at).slice(0, 10)}`
                    }
                  />
                ))
              )}
              {s.count > s.patients.length && (
                <div className="text-xs text-center mt-1" style={{ color: 'var(--ink-3)' }}>
                  +{s.count - s.patients.length} não mostrados
                </div>
              )}
            </Column>
          ))}
        </div>
      )}
    </div>
  );
}
