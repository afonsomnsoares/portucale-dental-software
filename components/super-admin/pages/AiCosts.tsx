'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { DataTable, Empty, MetricCard, PageHeader, Spinner } from '@/components/ui';

interface Row {
  tenant_name: string | null;
  tenant_city: string | null;
  agent?: string;
  model?: string;
  calls: number;
  failed: number;
  unconfigured?: number;
  input_tokens: string;
  output_tokens: string;
  avg_ms?: number | null;
  costEur: number | null;
}
interface Data {
  days: number;
  configuredModel: string;
  pricePerMTok: Record<string, { input: number; output: number }>;
  byTenant: Row[];
  byAgent: Row[];
  byDay: Array<{ day: string; calls: number; input_tokens: string; output_tokens: string; costEur: number | null }>;
}

const n = (v: string | number) => Number(v || 0);
const fmtTok = (v: string | number) => n(v).toLocaleString('pt-PT');

export default function AiCosts() {
  const { api } = useAuth();
  const [d, setD] = useState<Data | null>(null);

  useEffect(() => {
    api('/platform/ai-usage')
      .then(setD)
      .catch(() => setD(null));
  }, [api]);

  if (!d) return <Spinner />;

  const totalCost = d.byTenant.reduce((a, r) => a + (r.costEur || 0), 0);
  const totalCalls = d.byTenant.reduce((a, r) => a + r.calls, 0);
  const totalIn = d.byTenant.reduce((a, r) => a + n(r.input_tokens), 0);
  const totalOut = d.byTenant.reduce((a, r) => a + n(r.output_tokens), 0);
  const price = d.pricePerMTok[d.configuredModel];

  if (!totalCalls) {
    return (
      <div>
        <PageHeader title="Custos de IA" sub={`Últimos ${d.days} dias`} />
        <Empty message="Nenhuma chamada ao modelo registada ainda" />
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 16, maxWidth: 720 }}>
          A contabilidade está ligada (tabela <code>ai_calls</code>, migração 053) e regista cada chamada em
          lib/agents/aiClient.ts. Uma tabela vazia significa uma de duas coisas: os agentes ainda não correram desde a
          migração, ou <code>ANTHROPIC_API_KEY</code> não está definida e o produto está a correr sem IA — que é um modo
          de funcionamento previsto, não uma avaria.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Custos de IA" sub={`Últimos ${d.days} dias · modelo ${d.configuredModel}`} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 24 }}>
        <MetricCard
          label="CUSTO ESTIMADO"
          value={`${totalCost.toFixed(2)} €`}
          sub={`${d.days} dias`}
          color="var(--cat-purple)"
        />
        <MetricCard label="CHAMADAS" value={totalCalls.toLocaleString('pt-PT')} sub="ao modelo" color="var(--accent)" />
        <MetricCard label="TOKENS DE ENTRADA" value={fmtTok(totalIn)} sub="acumulados" color="var(--urgency-ok)" />
        <MetricCard label="TOKENS DE SAÍDA" value={fmtTok(totalOut)} sub="acumulados" color="var(--urgency-soon)" />
      </div>

      <div className="card p-5" style={{ marginBottom: 16 }}>
        <div className="section-label mb-4">POR CLÍNICA</div>
        <DataTable
          cols={['Clínica', 'Chamadas', 'Falhas', 'Sem IA', 'Entrada', 'Saída', 'Custo est.']}
          rows={d.byTenant.map((r) => (
            <tr key={(r.tenant_name || 'plataforma') + r.calls}>
              <td style={{ fontWeight: 600 }}>{r.tenant_name || 'Plataforma (agente Grupo)'}</td>
              <td>{r.calls}</td>
              <td style={{ color: r.failed ? 'var(--urgency-critical)' : 'var(--text-secondary)' }}>{r.failed}</td>
              <td style={{ color: 'var(--text-muted)' }}>{r.unconfigured || 0}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{fmtTok(r.input_tokens)}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{fmtTok(r.output_tokens)}</td>
              <td style={{ fontWeight: 700 }}>{r.costEur === null ? '—' : `${r.costEur.toFixed(2)} €`}</td>
            </tr>
          ))}
        />
      </div>

      <div className="card p-5">
        <div className="section-label mb-4">POR AGENTE</div>
        <DataTable
          cols={['Agente', 'Modelo', 'Chamadas', 'Falhas', 'Entrada', 'Saída', 'Duração média', 'Custo est.']}
          rows={d.byAgent.map((r) => (
            <tr key={`${r.agent}${r.model}`}>
              <td style={{ fontFamily: '"JetBrains Mono",monospace', fontSize: 12 }}>{r.agent}</td>
              <td style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{r.model}</td>
              <td>{r.calls}</td>
              <td style={{ color: r.failed ? 'var(--urgency-critical)' : 'var(--text-secondary)' }}>{r.failed}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{fmtTok(r.input_tokens)}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{fmtTok(r.output_tokens)}</td>
              <td style={{ color: 'var(--text-secondary)' }}>{r.avg_ms ? `${r.avg_ms} ms` : '—'}</td>
              <td style={{ fontWeight: 700 }}>{r.costEur === null ? '—' : `${r.costEur.toFixed(2)} €`}</td>
            </tr>
          ))}
        />
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 16, maxWidth: 720 }}>
        O custo é <strong>estimado</strong>: tokens contados × preço de tabela
        {price ? ` (${price.input} € / ${price.output} € por milhão, entrada / saída)` : ''}. A fatura real é mais baixa
        sempre que o caching de prompts entra, e esta aplicação não vê isso. Serve para responder a «quem está a
        consumir» e «está a subir», não para conferir a fatura.
      </p>
    </div>
  );
}
