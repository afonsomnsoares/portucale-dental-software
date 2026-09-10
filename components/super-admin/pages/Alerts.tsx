'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, Empty, GhostBtn, PageHeader, Spinner } from '@/components/ui';

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
  const { api } = useAuth();
  const [items, setItems] = useState<Insight[] | null>(null);
  const [severity, setSeverity] = useState<string>('');

  useEffect(() => {
    setItems(null);
    api(`/platform/insights${severity ? `?severity=${severity}` : ''}`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [api, severity]);

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

      {!items ? (
        <Spinner />
      ) : !items.length ? (
        <Empty message="Nada por tratar — ou os agentes ainda não correram" />
      ) : (
        items.map((i) => {
          const m = SEV[i.severity] || SEV.info;
          return (
            <div key={i.id} className="card p-4" style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <Badge label={m.label} bg={m.bg} color={m.color} />
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{i.title}</span>
                {i.impact_eur && (
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--urgency-critical)' }}>
                    {Math.round(Number(i.impact_eur)).toLocaleString('pt-PT')} €
                  </span>
                )}
              </div>
              {i.body && (
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 8px' }}>
                  {i.body}
                </p>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
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
