'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { AlertBanner, Empty, GhostBtn, MetricCard, PageHeader, PrimaryBtn, Spinner, Textarea } from '@/components/ui';
import { formatEUR } from '@/lib/constants';

// ─── O nível de grupo ───────────────────────────────────────────────────────
// Cinco perguntas que só se respondem com mais do que uma clínica à vista: onde é que há
// procura a mais e capacidade a mais, o que é que cada unidade tem de equipamento e de
// equipa, quem é audiência de campanha, e quanto é que o grupo inteiro espera faturar.
//
// A primeira é a única que toca em doentes, e por isso é a única com uma porta legal à
// frente. As outras quatro são leitura.

interface Candidate {
  patientId: string;
  name: string;
  treatmentType: string;
  minDuration: number;
  eligible: boolean;
  reason: string;
}
interface Imbalance {
  fromTenantId: string;
  fromName: string;
  toTenantId: string;
  toName: string;
  movableMinutes: number;
  movablePatients: number;
  valueEur: number | null;
  candidates: Candidate[];
}
interface Clinic {
  tenantId: string;
  name: string;
  city: string;
  transfersEnabled: boolean;
  transfersBasis: string;
}
interface Capacity {
  tenantId: string;
  name: string;
  occupancy: number;
  free: number;
  unmet: number;
  spare: number;
  waitingPatients: number;
}
interface Aggregate {
  total: number;
  unreliableClinics: string[];
  contributors: number;
}
interface GroupData {
  clinics: Clinic[];
  capacities?: Capacity[];
  imbalances: Imbalance[];
  equipment: Array<{ clinic: string; name: string; status: string; available: boolean }>;
  staff: Array<{ clinic: string; name: string; role: string; specialties: string[]; weeklyMinutes: number }>;
  specialtyGaps: Array<{ clinic: string; missing: string[] }>;
  campaigns: Array<{ clinic: string; dormant: number; dormantHighValue: number; consentedForOutreach: number }>;
  forecast: { horizonDays: number; revenue: Aggregate; demand: Aggregate; noShowRate: number | null } | null;
}

const horas = (m: number) => `${Math.round(m / 60)} h`;

export default function GroupView() {
  const { api } = useAuth();
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [aEditar, setAEditar] = useState<string | null>(null);
  const [base, setBase] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      setData(await api('/platform/group'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function guardarBase(tenantId: string, enabled: boolean) {
    setErro('');
    try {
      await api('/platform/group/transfers', { method: 'PUT', body: { tenantId, enabled, basis: base } });
      setAEditar(null);
      setBase('');
      load();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao guardar.');
    }
  }

  if (loading) return <Spinner />;
  if (!data) return <Empty message={erro || 'Sem dados.'} />;
  if (data.clinics.length < 2) {
    return (
      <div>
        <PageHeader title="Grupo" sub="Comparação e redistribuição entre unidades" />
        <Empty message="O nível de grupo só existe com duas ou mais clínicas activas." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Grupo"
        sub={`${data.clinics.length} unidades · capacidade, equipa, equipamento, campanhas e previsão somados`}
      >
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      {erro && <AlertBanner type="danger">{erro}</AlertBanner>}

      {/* ── Previsão do grupo ── */}
      {data.forecast && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
          <MetricCard
            label={`Receita prevista (${data.forecast.horizonDays} dias)`}
            value={formatEUR(data.forecast.revenue.total)}
          />
          <MetricCard label="Consultas previstas" value={String(Math.round(data.forecast.demand.total))} />
          <MetricCard
            label="Taxa de faltas do grupo"
            value={data.forecast.noShowRate === null ? '—' : `${Math.round(data.forecast.noShowRate * 100)}%`}
            sub="ponderada pelo volume, não a média das unidades"
          />
        </div>
      )}
      {data.forecast && data.forecast.revenue.unreliableClinics.length > 0 && (
        <AlertBanner type="warning">
          Sem histórico suficiente em: {data.forecast.revenue.unreliableClinics.join(', ')}. Entram no total à mesma —
          excluí-las daria um número mais baixo com ar de mais rigoroso.
        </AlertBanner>
      )}

      {/* ── Capacidade por unidade ── */}
      <Secao titulo="Capacidade">
        {(data.capacities || []).map((c) => (
          <Linha
            key={c.tenantId}
            titulo={c.name}
            detalhe={`${Math.round(c.occupancy * 100)}% de ocupação · ${horas(c.free)} livres · ${c.waitingPatients} à espera`}
            realce={c.unmet > 0 ? 'procura por satisfazer' : c.spare > 0 ? `${horas(c.spare)} disponíveis` : ''}
          />
        ))}
      </Secao>

      {/* ── Redistribuição ── */}
      <Secao titulo="Redistribuição de doentes">
        {!data.imbalances.length ? (
          <Empty message="Nenhuma unidade está cheia com gente à espera enquanto outra tem folga." />
        ) : (
          data.imbalances.map((d) => (
            <div
              key={`${d.fromTenantId}-${d.toTenantId}`}
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-card)',
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>
                {d.fromName} → {d.toName}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>
                {horas(d.movableMinutes)} · até {d.movablePatients} doentes
                {d.valueEur !== null && ` · ${formatEUR(d.valueEur)} para ${d.toName}`}
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {d.candidates.slice(0, 5).map((c) => (
                  <div
                    key={c.patientId}
                    style={{
                      fontSize: 'var(--text-2xs)',
                      color: c.eligible ? 'var(--urgency-ok)' : 'var(--text-muted)',
                    }}
                  >
                    {c.eligible ? '✓' : '—'} {c.name} · {c.treatmentType}
                    {!c.eligible && ` · ${c.reason}`}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </Secao>

      {/* ── A porta legal ──
          Está aqui e não em Definições de propósito: quem olha para uma proposta de
          transferência e vê «o doente não consentiu» tem de ter à mão o sítio onde isso
          se resolve, e o que é preciso para o resolver. */}
      <Secao titulo="Transferências entre unidades — base legal">
        <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 10, maxWidth: '44rem' }}>
          Propor a um doente de uma unidade uma vaga noutra é comunicar dados entre dois responsáveis pelo tratamento e
          contactá-lo em nome de uma entidade com que ele nunca falou. Ligar isto declara que existe base para o fazer —
          e não dispensa o consentimento de cada doente.
        </div>
        {data.clinics.map((c) => (
          <div
            key={c.tenantId}
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-card)',
              padding: '8px 12px',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>{c.name}</div>
                <div
                  style={{
                    fontSize: 'var(--text-2xs)',
                    color: c.transfersEnabled ? 'var(--urgency-ok)' : 'var(--text-muted)',
                  }}
                >
                  {c.transfersEnabled ? `Autorizada — ${c.transfersBasis}` : 'Não autorizada'}
                </div>
              </div>
              {c.transfersEnabled ? (
                <GhostBtn onClick={() => guardarBase(c.tenantId, false)}>Desligar</GhostBtn>
              ) : aEditar === c.tenantId ? null : (
                <GhostBtn onClick={() => setAEditar(c.tenantId)}>Autorizar</GhostBtn>
              )}
            </div>
            {aEditar === c.tenantId && (
              <div style={{ marginTop: 10 }}>
                <Textarea
                  rows={2}
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  placeholder="Base legal — ex.: consentimento recolhido no acto de inscrição, revisto pelo DPO em …"
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <PrimaryBtn onClick={() => guardarBase(c.tenantId, true)} disabled={base.trim().length < 10}>
                    Autorizar
                  </PrimaryBtn>
                  <GhostBtn onClick={() => setAEditar(null)}>Cancelar</GhostBtn>
                </div>
              </div>
            )}
          </div>
        ))}
      </Secao>

      {/* ── Equipa e especialidades ── */}
      <Secao titulo="Equipa">
        {data.specialtyGaps.length === 0 ? (
          <Empty message="Todas as unidades cobrem as mesmas especialidades." />
        ) : (
          data.specialtyGaps.map((g) => (
            <Linha key={g.clinic} titulo={g.clinic} detalhe={`Sem ninguém em: ${g.missing.join(', ')}`} />
          ))
        )}
      </Secao>

      {/* ── Equipamento ── */}
      <Secao titulo="Equipamento indisponível">
        {data.equipment.filter((e) => !e.available).length === 0 ? (
          <Empty message="Todo o equipamento do grupo está operacional." />
        ) : (
          data.equipment
            .filter((e) => !e.available)
            .map((e) => <Linha key={`${e.clinic}-${e.name}`} titulo={`${e.clinic} · ${e.name}`} detalhe={e.status} />)
        )}
      </Secao>

      {/* ── Campanhas ── */}
      <Secao titulo="Audiência de campanha">
        {data.campaigns.map((c) => (
          <Linha
            key={c.clinic}
            titulo={c.clinic}
            detalhe={`${c.dormant} dormentes · ${c.dormantHighValue} de alto valor`}
            realce={`${c.consentedForOutreach} contactáveis`}
          />
        ))}
      </Secao>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div
        style={{
          fontSize: 'var(--text-2xs)',
          letterSpacing: 'var(--text-2xs-tracking)',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          fontWeight: 'var(--weight-medium)',
          marginBottom: 8,
        }}
      >
        {titulo}
      </div>
      {children}
    </div>
  );
}

function Linha({ titulo, detalhe, realce }: { titulo: string; detalhe: string; realce?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: 'var(--text-xs)',
      }}
    >
      <span>
        <b>{titulo}</b>
        <span style={{ color: 'var(--text-secondary)' }}> · {detalhe}</span>
      </span>
      {realce && <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{realce}</span>}
    </div>
  );
}
