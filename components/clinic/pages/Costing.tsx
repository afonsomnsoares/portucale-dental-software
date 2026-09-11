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
import { AlertBanner, Empty, Inp, PageHeader, PrimaryBtn, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
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
          fontSize: 'var(--text-2xs)',
          fontWeight: 'var(--weight-bold)',
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
                  fontSize: 'var(--text-2xs)',
                  letterSpacing: '.07em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  fontWeight: 'var(--weight-medium)',
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
              <td style={{ padding: '9px 14px', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                {b.label}
              </td>
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
                    fontSize: 'var(--text-xs)',
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

export default function Costing({
  initialReport,
  initialFrom,
  initialTo,
}: {
  initialReport?: Report;
  initialFrom?: string;
  initialTo?: string;
} = {}) {
  const { api } = useAuth();
  const [de, setDe] = useState(initialFrom ?? inicioDoMes);
  const [ate, setAte] = useState(initialTo ?? (() => new Date().toLocaleDateString('en-CA'))());
  const [aGravar, setAGravar] = useState(false);
  const [def, setDef] = useState<Settings | null>(null);

  // As duas leituras são independentes de propósito. As definições de custo são
  // opcionais — uma clínica que ainda não as preencheu vê a margem à mesma, com a
  // ressalva que o ecrã já mostra. Mas «ainda não preenchidas» e «não consegui
  // ler» não são a mesma coisa, e a segunda aparece em vez de se disfarçar da
  // primeira.
  const margemInicial = de === (initialFrom ?? '') && ate === (initialTo ?? '') ? initialReport : undefined;
  const margem = useQuery<Report>(`/finance/margin?from=${de}&to=${ate}`, { initialData: margemInicial });
  const definicoes = useQuery<{ settings: Settings; methods: Metodo[] }>('/finance/cost-settings');

  const rel = margem.data ?? null;
  const metodos = definicoes.data?.methods ?? [];
  const aCarregar = margem.loading;
  const erro = margem.error?.message ?? '';
  const avisoDefinicoes = definicoes.error?.message ?? '';
  const carregar = margem.refetch;

  // O formulário das definições é editável, por isso tem estado próprio — mas
  // parte sempre do que o servidor gravou.
  useEffect(() => {
    if (definicoes.data?.settings) setDef(definicoes.data.settings);
  }, [definicoes.data]);

  const [erroGravar, setErroGravar] = useState('');
  const gravarDef = useCallback(async () => {
    if (!def) return;
    setAGravar(true);
    setErroGravar('');
    try {
      await api('/finance/cost-settings', { method: 'PUT', body: def });
      // Mudar a base de imputação muda a margem: revalidar as duas.
      definicoes.refetch();
      carregar();
    } catch (e) {
      setErroGravar(e instanceof Error ? e.message : 'Não foi possível guardar a base de imputação.');
    } finally {
      setAGravar(false);
    }
  }, [api, def, carregar, definicoes]);

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

      {avisoDefinicoes ? <AlertBanner type="warning">{avisoDefinicoes}</AlertBanner> : null}
      {erroGravar ? <AlertBanner type="danger">{erroGravar}</AlertBanner> : null}
      {erro && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-control)',
            marginBottom: 12,
            fontSize: 'var(--text-sm)',
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
                fontSize: 'var(--text-xs)',
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
              gap: 12,
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
                <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>{m.l}</div>
                <div
                  style={{
                    fontSize: 'var(--text-base)',
                    fontWeight: 'var(--weight-bold)',
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
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
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', marginBottom: 4 }}>
                Base de imputação
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', margin: '0 0 12px' }}>
                Como é que o custo fixo mensal se reparte pelas consultas. Mudar isto muda todos os números acima, e
                todos os relatórios já emitidos — é retroativo por natureza.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
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
                    <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>{m.label}</div>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {m.note}
                    </div>
                  </button>
                ))}
              </div>

              <div className="grid-pair" style={{ gap: 12 }}>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: o Inp abaixo É o controlo deste label */}
                <label style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  Custo fixo mensal (€)
                  <Inp
                    type="number"
                    value={String(def.fixedCostMonthly)}
                    onChange={(e) => setDef({ ...def, fixedCostMonthly: Number(e.target.value) })}
                  />
                </label>
                {/* biome-ignore lint/a11y/noLabelWithoutControl: o Inp abaixo É o controlo deste label */}
                <label style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                  Custo de trabalho por hora (€)
                  <Inp
                    type="number"
                    value={String(def.labourCostPerHour)}
                    onChange={(e) => setDef({ ...def, labourCostPerHour: Number(e.target.value) })}
                  />
                </label>
              </div>

              <div style={{ marginTop: 12 }}>
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
