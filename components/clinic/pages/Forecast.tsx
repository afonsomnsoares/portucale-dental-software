'use client';
// ─── Previsão ───────────────────────────────────────────────────────────────
// Os seis eixos de lib/forecast.ts — receita, ocupação, procura, cancelamentos, faltas e
// capacidade livre — que existiam com rota, testes e nenhum ecrã.
//
// ─── A decisão de desenho que importa ───────────────────────────────────────
// `isReliable` distingue uma previsão com base suficiente de uma extrapolação, e o
// forecastCalc.ts exige três observações do mesmo dia da semana para não estar a
// adivinhar. Mostrar as duas com o mesmo peso apagaria essa distinção — que é a parte
// honesta do módulo. Por isso as pouco fiáveis aparecem esbatidas e dizem-no por
// extenso, em vez de serem escondidas: uma clínica nova tem o direito de ver que o
// sistema ainda não sabe o suficiente sobre ela.
import { useState } from 'react';
import { Empty, PageHeader, Sel, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { formatEUR } from '@/lib/constants';

interface ForecastDay {
  date: string;
  value: number;
  low: number;
  high: number;
  basis: number;
}

interface MetricForecast {
  metric: string;
  label: string;
  unit: 'eur' | 'pct' | 'count' | 'hours';
  reliable: boolean;
  total: number;
  totalLow: number;
  totalHigh: number;
  trend: number;
  confidentDays: number;
  days: ForecastDay[];
}

function fmt(v: number, unit: MetricForecast['unit']) {
  if (unit === 'eur') return formatEUR(v);
  if (unit === 'pct') return `${Math.round(v)}%`;
  if (unit === 'hours') return `${Math.round(v)} h`;
  return String(Math.round(v));
}

// A ocupação é uma média ao longo do horizonte; as outras somam-se. Somar percentagens
// de dias diferentes daria um número sem significado nenhum.
function totalDe(f: MetricForecast) {
  return f.unit === 'pct' ? f.total / Math.max(1, f.days.length) : f.total;
}

function Tendencia({ trend }: { trend: number }) {
  const pct = Math.round((trend - 1) * 100);
  if (pct === 0) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>estável</span>;
  const sobe = pct > 0;
  return (
    <span style={{ fontSize: 11, color: sobe ? 'var(--urgency-ok)' : 'var(--urgency-soon)' }}>
      {sobe ? '↑' : '↓'} {Math.abs(pct)}% de tendência
    </span>
  );
}

// Um gráfico de barras em SVG, sem biblioteca: são catorze valores e uma banda de
// incerteza. A banda é o ponto — uma previsão sem intervalo lê-se como uma certeza.
function Sparkline({ days, unit }: { days: ForecastDay[]; unit: MetricForecast['unit'] }) {
  if (!days.length) return null;
  const w = 100;
  const h = 34;
  const max = Math.max(...days.map((d) => d.high), 1);
  const passo = w / days.length;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 40, display: 'block', marginTop: 10 }}
      role="img"
      aria-label={`Projeção diária, máximo ${fmt(max, unit)}`}
    >
      <title>{`Projeção diária, máximo ${fmt(max, unit)}`}</title>
      {days.map((d, i) => {
        const x = i * passo;
        const largura = Math.max(1, passo - 1.2);
        const alto = (d.value / max) * h;
        const altoBanda = ((d.high - d.low) / max) * h;
        const yBanda = h - (d.high / max) * h;
        return (
          <g key={d.date}>
            <rect
              x={x}
              y={yBanda}
              width={largura}
              height={Math.max(0.6, altoBanda)}
              fill="var(--accent)"
              opacity={0.18}
            />
            <rect x={x} y={h - alto} width={largura} height={Math.max(0.6, alto)} fill="var(--accent)" opacity={0.75} />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * `initialData` e `initialDays` vêm da página do servidor
 * (app/dashboard/admin/forecast/page.tsx), que já leu a previsão de arranque
 * diretamente da base de dados. São opcionais porque este componente também é
 * montado sem eles — e aí comporta-se como antes, pedindo no primeiro efeito.
 *
 * Mudar o horizonte continua a ser trabalho do cliente: é interação, e uma volta
 * ao servidor por cada mexida no seletor seria pior do que o problema.
 */
export default function Forecast({
  initialData,
  initialDays = '14',
}: {
  initialData?: { forecasts: MetricForecast[] };
  initialDays?: string;
} = {}) {
  const [dias, setDias] = useState(initialDays);
  const consulta = useQuery<{ forecasts: MetricForecast[] }>(`/forecast?days=${dias}`, {
    initialData: dias === initialDays ? initialData : undefined,
  });
  const dados = consulta.data?.forecasts ?? [];
  const aCarregar = consulta.loading;
  const erro = consulta.error?.message ?? '';

  return (
    <div>
      <PageHeader
        title="Previsão"
        sub="Mediana por dia da semana, com tendência limitada. O que não tem histórico suficiente diz que não tem."
      >
        <Sel value={dias} onChange={(e) => setDias(e.target.value)} style={{ width: 150 }}>
          <option value="7">Próximos 7 dias</option>
          <option value="14">Próximos 14 dias</option>
          <option value="30">Próximos 30 dias</option>
          <option value="60">Próximos 60 dias</option>
        </Sel>
      </PageHeader>

      {erro && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-control)',
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {erro}
        </div>
      )}

      {aCarregar ? (
        <Spinner />
      ) : dados.length === 0 ? (
        <Empty message="Ainda não há histórico suficiente para prever seja o que for. Volta quando a clínica tiver algumas semanas de consultas." />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 14,
          }}
        >
          {dados.map((f) => (
            <div
              key={f.metric}
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-card)',
                background: 'var(--bg-surface)',
                padding: '14px 16px 12px',
                opacity: f.reliable ? 1 : 0.72,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{f.label}</span>
                <Tendencia trend={f.trend} />
              </div>

              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                {fmt(totalDe(f), f.unit)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                entre {fmt(f.unit === 'pct' ? f.totalLow / Math.max(1, f.days.length) : f.totalLow, f.unit)} e{' '}
                {fmt(f.unit === 'pct' ? f.totalHigh / Math.max(1, f.days.length) : f.totalHigh, f.unit)}
              </div>

              <Sparkline days={f.days} unit={f.unit} />

              {!f.reliable && (
                <div style={{ fontSize: 11, color: 'var(--urgency-soon)', marginTop: 8 }}>
                  Base fraca — só {f.confidentDays} de {f.days.length} dias têm histórico que chegue. Lê isto como uma
                  ordem de grandeza, não como um número.
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
