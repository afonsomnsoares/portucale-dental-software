'use client';
import { useState } from 'react';
import { AlertBanner, Badge, Empty, MetricCard, PrimaryBtn, Spinner } from '@/components/ui';
import type { DemandSource, DynamicPlan, PlanOfferView, PlanSlotView } from '@/lib/types';

// A vista do agente de agenda a trabalhar: os espaços vazios das próximas
// semanas e, em cada um, quem o motor escolheu para lá pôr — com a pontuação e
// a razão à vista.
//
// A aba "Otimizador" mostra o que fazer com as consultas que JÁ existem (mover,
// atribuir dentista). Esta mostra o problema inverso, que é o que dá dinheiro:
// cadeira parada e uma base de dados cheia de gente com motivo para lá estar.
//
// Nada aqui esconde a pontuação. Uma clínica que não perceba porque é que o
// software ligou àquele doente e não a outro deixa de confiar nele em duas
// semanas — e com razão.

const SOURCE_META: Record<DemandSource, { label: string; bg: string; color: string }> = {
  waitlist: { label: 'Lista de espera', bg: 'var(--green-bg)', color: 'var(--green)' },
  treatment_open: { label: 'Plano parado', bg: 'var(--brand-bg)', color: 'var(--brand)' },
  recall_due: { label: 'Recall vencido', bg: 'var(--amber-bg)', color: 'var(--amber)' },
  advance: { label: 'Antecipação', bg: 'var(--purple-bg, #EAE6FF)', color: 'var(--purple, #5243AA)' },
  reactivation: { label: 'Reativação', bg: 'var(--surface-2)', color: 'var(--ink-2)' },
};

const MODE_BANNER: Record<string, { type: string; text: string }> = {
  off: { type: 'warning', text: 'O agente de agenda está desligado nesta clínica.' },
  propose: {
    type: 'info',
    text: 'O agente calcula e mostra, mas não contacta ninguém. Para passar a contactar, muda a autonomia na Política.',
  },
  contact: { type: 'info', text: 'O agente contacta os doentes abaixo. A marcação continua a passar por uma pessoa.' },
  autobook: { type: 'info', text: 'O agente contacta e, quando o doente responde SIM, a consulta fica marcada.' },
};

function formatHours(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function formatDate(date: string) {
  const [y, m, d] = String(date || '').split('-');
  return y ? `${d}/${m}` : date;
}

function scoreColor(score: number) {
  if (score >= 70) return 'var(--green)';
  if (score >= 50) return 'var(--amber)';
  return 'var(--ink-3)';
}

function OfferRow({ offer }: { offer: PlanOfferView }) {
  const meta = SOURCE_META[offer.source];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '10px 0',
        borderTop: '1px solid var(--border-light, #EBECF0)',
      }}
    >
      <div style={{ width: 44, flexShrink: 0, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: scoreColor(offer.score), lineHeight: 1 }}>
          {offer.score}
        </div>
        <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
          pts
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{offer.patientName}</span>
          <Badge label={meta.label} bg={meta.bg} color={meta.color} />
          {!offer.canSms && <Badge label="Sem SMS" bg="var(--red-bg)" color="var(--red)" />}
          {offer.advanceFrom && (
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
              tem consulta em {formatDate(offer.advanceFrom.date)}
            </span>
          )}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--ink-2)', lineHeight: 1.5 }}>
          {offer.startTime} · {offer.treatmentType} ({offer.durationMinutes} min)
          {offer.dentistName ? ` · ${offer.dentistName}` : ' · sem dentista atribuído'}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--ink-3)', lineHeight: 1.5 }}>
          {offer.reason}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: 'right' }}>
        {offer.valueEur > 0 && (
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>≈ {offer.valueEur} €</div>
        )}
        <div className="text-xs" style={{ color: offer.noShowRiskPct >= 50 ? 'var(--red)' : 'var(--ink-3)' }}>
          risco {offer.noShowRiskPct}%
        </div>
      </div>
    </div>
  );
}

function SlotCard({ slot }: { slot: PlanSlotView }) {
  return (
    <div className="card" style={{ padding: '12px 14px', boxShadow: 'none', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between" style={{ gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--ink)' }}>
          Cadeira {slot.chair} · {formatDate(slot.date)} · {slot.startTime}–{slot.endTime}
        </span>
        <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)' }}>{formatHours(slot.freeMinutes)}</span>
          <Badge
            label={slot.kind === 'gap' ? 'Buraco' : 'Ponta do dia'}
            bg={slot.kind === 'gap' ? 'var(--red-bg)' : 'var(--surface-2)'}
            color={slot.kind === 'gap' ? 'var(--red)' : 'var(--ink-2)'}
          />
        </div>
      </div>
      {slot.agentNote && (
        <div className="text-xs mt-1" style={{ color: 'var(--brand)', fontStyle: 'italic' }}>
          {slot.agentNote}
        </div>
      )}
      {slot.offers.map((o) => (
        <OfferRow key={o.candidateKey} offer={o} />
      ))}
    </div>
  );
}

export default function DynamicSchedulingTab({
  plan,
  loading,
  canManage,
  running,
  onRun,
}: {
  plan: DynamicPlan | null;
  loading?: boolean;
  canManage?: boolean;
  running?: boolean;
  onRun?: () => void;
}) {
  const [showWithheld, setShowWithheld] = useState(false);

  if (loading) return <Spinner />;
  if (!plan) return <Empty message="Sem dados do agente de agenda." />;

  const banner = MODE_BANNER[plan.policy.mode];
  const sources = Object.entries(plan.counts).filter(([, n]) => n > 0) as Array<[DemandSource, number]>;

  return (
    <div>
      {banner && <AlertBanner type={banner.type}>{banner.text}</AlertBanner>}
      {plan.autonomy.contacts && plan.autonomy.quietNow && (
        <AlertBanner type="warning">
          Horas de silêncio ({String(plan.policy.quietHoursStart).padStart(2, '0')}h–
          {String(plan.policy.quietHoursEnd).padStart(2, '0')}h) — nada é enviado agora.
        </AlertBanner>
      )}
      {plan.warnings.map((w) => (
        <AlertBanner key={w} type="warning">
          {w}
        </AlertBanner>
      ))}

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}
        className="mb-5"
      >
        <MetricCard
          label="ESPAÇOS LIVRES"
          value={plan.totals.openings}
          sub={`nos próximos ${plan.policy.horizonDays} dias`}
          color="var(--ink-2)"
        />
        <MetricCard
          label="CAPACIDADE PREENCHÍVEL"
          value={formatHours(plan.totals.fillableMinutes)}
          sub={`${plan.totals.plannedOffers} encaixes possíveis de ${plan.totals.candidates} doentes com motivo para vir`}
          color={plan.totals.fillableMinutes > 0 ? 'var(--green)' : 'var(--ink-3)'}
        />
        <MetricCard
          label="VALOR ESTIMADO"
          value={`${plan.totals.estimatedValueEur} €`}
          sub="mediana histórica das consultas do mesmo tipo nesta clínica"
          color="var(--brand)"
        />
        <MetricCard
          label="POR CONTACTAR HOJE"
          value={plan.totals.contactableOffers}
          sub={
            plan.autonomy.contacts
              ? `restam ${plan.remainingContactBudget} contactos no teto diário`
              : 'a política não autoriza contacto automático'
          }
          color={plan.autonomy.contacts ? 'var(--amber)' : 'var(--ink-3)'}
        />
      </div>

      {sources.length > 0 && (
        <div className="flex items-center gap-2 mb-4" style={{ flexWrap: 'wrap' }}>
          <span className="section-label">PROCURA ENCONTRADA</span>
          {sources.map(([source, n]) => (
            <Badge
              key={source}
              label={`${SOURCE_META[source].label}: ${n}`}
              bg={SOURCE_META[source].bg}
              color={SOURCE_META[source].color}
            />
          ))}
        </div>
      )}

      {canManage && onRun && (
        <div className="flex items-center justify-between mb-4" style={{ gap: 12 }}>
          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
            Correr agora faz o mesmo que a passagem automática: envia as ofertas que a política autoriza.
          </span>
          <PrimaryBtn onClick={onRun} disabled={running || !plan.autonomy.contacts}>
            {running ? 'A contactar…' : 'Correr agora'}
          </PrimaryBtn>
        </div>
      )}

      {!plan.slots.length ? (
        <Empty
          message={
            plan.totals.openings === 0
              ? 'Sem espaços livres na janela — a agenda está cheia.'
              : 'Há espaços livres, mas ninguém na base encaixa neles com pontuação suficiente.'
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {plan.slots.map((s) => (
            <SlotCard key={s.key} slot={s} />
          ))}
        </div>
      )}

      {plan.withheld.length > 0 && (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowWithheld((v) => !v)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <span className="section-label">
              {showWithheld ? '▾' : '▸'} RETIDOS PELA POLÍTICA ({plan.withheld.length})
            </span>
          </button>
          {showWithheld && (
            <div className="card mt-2" style={{ padding: 0 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th className="data-th">Doente</th>
                    <th className="data-th">Origem</th>
                    <th className="data-th">Horário</th>
                    <th className="data-th">Porquê</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.withheld.map((w) => (
                    <tr
                      key={`${w.patientName}-${w.date}-${w.startTime}-${w.reason}`}
                      style={{ borderBottom: '1px solid var(--border-light, #F4F7FA)' }}
                    >
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {w.patientName}
                      </td>
                      <td className="data-td">{w.sourceLabel}</td>
                      <td className="data-td" style={{ color: 'var(--ink-2)' }}>
                        {formatDate(w.date)} · {w.startTime}
                      </td>
                      <td className="data-td" style={{ color: 'var(--ink-2)' }}>
                        {w.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
