'use client';
import { useState } from 'react';
import { Badge, Empty, ErrorState, GhostBtn, PageHeader, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

interface Insight {
  id: string;
  tenant_id: string | null;
  agent_id: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  impact_eur: string | null;
  created_at: string;
  tenant_name: string | null;
  tenant_city: string | null;
}

const SEV: Record<string, { bg: string; color: string; label: string }> = {
  critical: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)', label: 'CRÍTICO' },
  warning: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)', label: 'AVISO' },
  info: { bg: 'var(--accent-bg)', color: 'var(--accent)', label: 'INFO' },
};

// Alertas de toda a rede. A fonte é agent_insights — o que os agentes concluíram e
// ainda ninguém tratou. Um insight de plataforma (agente Grupo) tem tenant_id NULL e
// aparece atribuído à rede, não a uma clínica.
export default function Alerts() {
  const [severity, setSeverity] = useState<string>('');
  const itemsQuery = useQuery<Insight[]>(`/platform/insights${severity ? `?severity=${severity}` : ''}`);
  const items = itemsQuery.data ?? null;

  const totalImpact = (items || []).reduce((a, i) => a + Number(i.impact_eur || 0), 0);

  return (
    <div>
      <PageHeader
        title="Alertas"
        sub={
          items
            ? `${items.length} por tratar em toda a rede${totalImpact ? ` · ${Math.round(totalImpact).toLocaleString('pt-PT')} € em risco` : ''}`
            : undefined
        }
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['', 'critical', 'warning', 'info'].map((s) => (
          <GhostBtn
            key={s || 'all'}
            onClick={() => setSeverity(s)}
            style={severity === s ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}}
          >
            {s ? SEV[s].label : 'TODOS'}
          </GhostBtn>
        ))}
      </div>

      {itemsQuery.error ? (
        <ErrorState error={itemsQuery.error} onRetry={itemsQuery.refetch} message="Não foi possível ler os alertas." />
      ) : !items ? (
        <Spinner />
      ) : !items.length ? (
        <Empty message="Nada por tratar — ou os agentes ainda não correram" />
      ) : (
        items.map((i) => {
          const m = SEV[i.severity] || SEV.info;
          return (
            <div key={i.id} className="card p-4" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <Badge label={m.label} bg={m.bg} color={m.color} />
                <span
                  style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 'var(--weight-semibold)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {i.title}
                </span>
                {i.impact_eur && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--weight-bold)',
                      color: 'var(--urgency-critical)',
                    }}
                  >
                    {Math.round(Number(i.impact_eur)).toLocaleString('pt-PT')} €
                  </span>
                )}
              </div>
              {i.body && (
                <p
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-secondary)',
                    lineHeight: 'var(--text-sm-leading)',
                    margin: '0 0 8px',
                  }}
                >
                  {i.body}
                </p>
              )}
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                {/* tenant_id NULL = insight do agente Grupo, que compara clínicas. */}
                {i.tenant_name || 'Plataforma (toda a rede)'}
                {i.tenant_city ? ` · ${i.tenant_city}` : ''} · agente {i.agent_id} · {i.kind} ·{' '}
                {new Date(i.created_at).toLocaleString('pt-PT')}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
