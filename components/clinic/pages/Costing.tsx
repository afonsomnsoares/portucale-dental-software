'use client';
// ─── Custos e margem ────────────────────────────────────────────────────────
// O módulo de custeio da migração 047 — `computeMarginReport`, `getCostSettings`,
// `costCoverage` — com duas rotas e nenhuma página. A clínica podia ver receita e não
// podia ver quanto lhe sobrava dela.
//
// ─── A cobertura vem antes dos números, e não depois ────────────────────────
// `costCoverage` diz que fração dos itens de inventário tem preço de custo declarado.
// Sem preços, o custo de material vem subavaliado e a margem sai OTIMISTA — que é o pior
// sentido para um erro deste tipo. O aviso está no topo e não em rodapé porque uma
// margem de 62% lida sem esse contexto leva a decisões que uma margem de 41% não levaria.
//
// A base de imputação está na mesma página que os números que ela produz, de propósito:
// mudá-la muda todos os relatórios retroativamente, e escondê-la noutro ecrã faria com
// que alguém lesse a margem sem saber sobre que regra ela foi calculada.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, Inp, PageHeader, PrimaryBtn, Spinner } from '@/components/ui';
import { formatEUR } from '@/lib/constants';

interface Margin {
  revenue: number;
  materialCost: number;
  labourCost: number;
  allocatedFixedCost: number;
  contributionMargin: number;
  contributionMarginPct: number | null;
  netMargin: number;
  netMarginPct: number | null;
}
interface Breakdown {
  key: string;
  label: string;
  appointments: number;
  margin: Margin;
}
interface Report {
  from: string;
  to: string;
  method: string;
  total: Margin;
  byDentist: Breakdown[];
  byChair: Breakdown[];
  byTreatmentType: Breakdown[];
  coverage: { itemsWithCost: number; itemsTotal: number; coveragePct: number; reliable: boolean };
  warnings: string[];
}
interface Metodo {
  value: string;
  label: string;
  note: string;
}
interface Settings {
  allocationMethod: string;
  fixedCostMonthly: number;
  labourCostPerHour: number;
}

function pct(v: number | null) {
  return v === null ? '—' : `${Math.round(v)}%`;
}

function inicioDoMes() {
  return `${new Date().toLocaleDateString('en-CA').slice(0, 7)}-01`;
}

function Tabela({ titulo, linhas }: { titulo: string; linhas: Breakdown[] }) {
  if (!linhas.length) return null;
  return (
    <div
      style={{
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-card)',
        background: 'var(--bg-surface)',
        overflowX: 'auto',
      }}
    >
      <div
        style={{
          padding: '11px 14px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {titulo}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
        <thead>
          <tr>
            {['', 'Consultas', 'Receita', 'Material', 'Margem de contribuição', 'Margem líquida'].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: h ? 'right' : 'left',
                  padding: '7px 14px',
                  fontSize: 10,
                  letterSpacing: '.07em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  fontWeight: 500,
                  borderBottom: '1px solid var(--border-strong)',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((b) => (
            <tr key={b.key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <td style={{ padding: '9px 14px', fontSize: 12.5, fontWeight: 600 }}>{b.label}</td>
              {[
                { k: 'consultas', v: String(b.appointments) },
                { k: 'receita', v: formatEUR(b.margin.revenue) },
                { k: 'material', v: formatEUR(b.margin.materialCost) },
                {
                  k: 'contribuicao',
                  v: `${formatEUR(b.margin.contributionMargin)} · ${pct(b.margin.contributionMarginPct)}`,
                  margem: true,
                },
                {
                  k: 'liquida',
                  v: `${formatEUR(b.margin.netMargin)} · ${pct(b.margin.netMarginPct)}`,
                  margem: true,
                },
              ].map((c) => (
                <td
                  key={c.k}
                  style={{
                    padding: '9px 14px',
                    fontSize: 12.5,
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    color: c.margem && b.margin.netMargin < 0 ? 'var(--urgency-critical)' : 'var(--text-secondary)',
                  }}
                >
                  {c.v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Costing() {
  const { api } = useAuth();
  const [rel, setRel] = useState<Report | null>(null);
  const [metodos, setMetodos] = useState<Metodo[]>([]);
  const [def, setDef] = useState<Settings | null>(null);
  const [de, setDe] = useState(inicioDoMes);
  const [ate, setAte] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [aCarregar, setACarregar] = useState(true);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setACarregar(true);
    setErro('');
    try {
      const [r, c] = await Promise.all([
        api(`/finance/margin?from=${de}&to=${ate}`),
        api('/finance/cost-settings').catch(() => null),
      ]);
      setRel(r || null);
      if (c) {
        setDef(c.settings);
        setMetodos(c.methods || []);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível calcular a margem.');
    } finally {
      setACarregar(false);
    }
  }, [api, de, ate]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const gravarDef = useCallback(async () => {
    if (!def) return;
    setAGravar(true);
    setErro('');
    try {
      await api('/finance/cost-settings', { method: 'PUT', body: def });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível guardar a base de imputação.');
    } finally {
      setAGravar(false);
    }
  }, [api, def, carregar]);

  return (
    <div>
      <PageHeader
        title="Custos e Margem"
        sub="O que sobra depois do material, do trabalho e da parte dos custos fixos que cada consulta carrega."
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <Inp type="date" value={de} onChange={(e) => setDe(e.target.value)} style={{ width: 150 }} aria-label="De" />
          <Inp
            type="date"
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            style={{ width: 150 }}
            aria-label="Até"
          />
        </div>
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
      ) : !rel ? (
        <Empty message="Sem consultas fechadas no período — não há margem a calcular." />
      ) : (
        <>
          {/* ── Honestidade antes dos números ── */}
          {(!rel.coverage.reliable || rel.warnings.length > 0) && (
            <div
              style={{
                background: 'var(--urgency-soon-bg)',
                color: 'var(--urgency-soon)',
                padding: '11px 15px',
                borderRadius: 'var(--radius-card)',
                marginBottom: 16,
                fontSize: 12.5,
                lineHeight: 1.55,
              }}
            >
              {!rel.coverage.reliable && (
                <div>
                  Só {rel.coverage.itemsWithCost} de {rel.coverage.itemsTotal} itens têm preço de custo declarado (
                  {rel.coverage.coveragePct}%). O custo de material sai subavaliado e a margem abaixo está{' '}
                  <b>otimista</b>.
                </div>
              )}
              {rel.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}

          {/* ── O total ── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: 14,
              marginBottom: 20,
            }}
          >
            {[
              { l: 'Receita', v: formatEUR(rel.total.revenue) },
              { l: 'Material', v: formatEUR(rel.total.materialCost) },
              { l: 'Trabalho', v: formatEUR(rel.total.labourCost) },
              { l: 'Custos fixos imputados', v: formatEUR(rel.total.allocatedFixedCost) },
              {
                l: 'Margem de contribuição',
                v: `${formatEUR(rel.total.contributionMargin)} · ${pct(rel.total.contributionMarginPct)}`,
              },
              {
                l: 'Margem líquida',
                v: `${formatEUR(rel.total.netMargin)} · ${pct(rel.total.netMarginPct)}`,
                cor: rel.total.netMargin < 0 ? 'var(--urgency-critical)' : 'var(--urgency-ok)',
              },
            ].map((m) => (
              <div
                key={m.l}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-card)',
                  background: 'var(--bg-surface)',
                  padding: '12px 14px',
                }}
              >
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.l}</div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    marginTop: 3,
                    color: m.cor || 'var(--text-primary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {m.v}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 22 }}>
            <Tabela titulo="Por dentista" linhas={rel.byDentist} />
            <Tabela titulo="Por cadeira" linhas={rel.byChair} />
            <Tabela titulo="Por tipo de tratamento" linhas={rel.byTreatmentType} />
          </div>

          {/* ── A base de imputação ── */}
          {def && (
            <div
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-card)',
                background: 'var(--bg-surface)',
                padding: 16,
                maxWidth: '46rem',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Base de imputação</div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                Como é que o custo fixo mensal se reparte pelas consultas. Mudar isto muda todos os números acima, e
                todos os relatórios já emitidos — é retroativo por natureza.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 14 }}>
                {metodos.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setDef({ ...def, allocationMethod: m.value })}
                    style={{
                      textAlign: 'left',
                      padding: '9px 12px',
                      borderRadius: 'var(--radius-control)',
                      border: `1px solid ${m.value === def.allocationMethod ? 'var(--accent)' : 'var(--border-subtle)'}`,
                      background: m.value === def.allocationMethod ? 'var(--accent-bg)' : 'transparent',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>{m.label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{m.note}</div>
                  </button>
                ))}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: o Inp abaixo É o controlo deste label */}
                <label style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Custo fixo mensal (€)
                  <Inp
                    type="number"
                    value={String(def.fixedCostMonthly)}
                    onChange={(e) => setDef({ ...def, fixedCostMonthly: Number(e.target.value) })}
                  />
                </label>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: o Inp abaixo É o controlo deste label */}
                <label style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Custo de trabalho por hora (€)
                  <Inp
                    type="number"
                    value={String(def.labourCostPerHour)}
                    onChange={(e) => setDef({ ...def, labourCostPerHour: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div style={{ marginTop: 14 }}>
                <PrimaryBtn onClick={gravarDef} disabled={aGravar}>
                  {aGravar ? 'A guardar…' : 'Guardar base de imputação'}
                </PrimaryBtn>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
