'use client';
import type { ReactNode } from 'react';
import { Empty } from '@/components/ui';
import { formatPhonePT } from '@/lib/constants';
import type { JourneyPatient, JourneyStageKey, Lead, LifecycleData } from '@/lib/types';

const STAGE_COLOR: Record<JourneyStageKey, string> = {
  booked: 'var(--accent)',
  first_visit_done: 'var(--cat-teal)',
  plan_presented: 'var(--urgency-soon)',
  plan_accepted: 'var(--cat-purple)',
  in_treatment: 'var(--accent)',
  completed: 'var(--urgency-ok)',
  recall_due: 'var(--urgency-critical)',
  booked_again: 'var(--urgency-ok)',
};

// Colors the "próxima ação" chip by urgency — matches the mapping in
// components/patient/NextActionBanner.tsx (that one drives the banner on a single
// patient's page; this drives a compact chip per card across a whole board).
const ACTION_COLOR: Record<string, { bg: string; color: string }> = {
  MISSING_DATA: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  OPEN_TASKS: { bg: 'var(--accent-bg)', color: 'var(--accent)' },
  PLAN_NOT_ACCEPTED: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  REACTIVATE: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  NO_UPCOMING_VISIT: { bg: 'var(--accent-bg)', color: 'var(--accent)' },
};

function ActionChip({ action }: { action: JourneyPatient['next_action'] }) {
  if (!action || action.code === 'UP_TO_DATE') return null;
  const c = ACTION_COLOR[action.code] || { bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' };
  return (
    <div
      className="text-xs mt-1.5"
      style={{
        background: c.bg,
        color: c.color,
        borderRadius: 'var(--radius-control)',
        padding: '3px 7px',
        fontWeight: 'var(--weight-semibold)',
      }}
    >
      {action.label}
    </div>
  );
}

const DORMANCY_LABEL: Record<string, string> = {
  '6-12m': '6-12 meses',
  '12-24m': '12-24 meses',
  '24m+': '+24 meses',
};

// Item 7's segmentação: a dormant patient who used to spend a lot gets a visibly
// different (redder) badge than a low-value one-off — same colour vocabulary as
// ACTION_COLOR above (var(--urgency-critical)/var(--accent)).
function SegmentBadge({ segment }: { segment: { dormancyBand: string; valueTier: string } }) {
  const isHighValue = segment.valueTier === 'high';
  return (
    <div
      className="text-xs mt-1.5"
      style={{
        background: isHighValue ? 'var(--urgency-critical-bg)' : 'var(--bg-sunken)',
        color: isHighValue ? 'var(--urgency-critical)' : 'var(--text-secondary)',
        borderRadius: 'var(--radius-control)',
        padding: '3px 7px',
        fontWeight: 'var(--weight-semibold)',
        display: 'inline-block',
      }}
    >
      {DORMANCY_LABEL[segment.dormancyBand] || segment.dormancyBand}
      {isHighValue ? ' · Alto valor' : ''}
    </div>
  );
}

function PatientCard({ p }: { p: JourneyPatient }) {
  const meta = p.last_visit
    ? `Última visita: ${String(p.last_visit).slice(0, 10)}`
    : `Registado: ${String(p.created_at).slice(0, 10)}`;
  return (
    <div className="card p-3 mb-2" style={{ border: '1px solid var(--border-subtle)' }}>
      <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>{p.name}</div>
      <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
        {p.phone ? formatPhonePT(p.phone) : p.email || '—'}
      </div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
        {meta}
      </div>
      <ActionChip action={p.next_action} />
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
        style={{ borderTop: `3px solid ${color}`, marginTop: -12, paddingTop: 12 }}
      >
        <span className="section-label">{title}</span>
        <span className="badge" style={{ background: 'var(--bg-sunken)', color: 'var(--text-secondary)' }}>
          {count}
        </span>
      </div>
      <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
        {description}
      </p>
      <div style={{ overflowY: 'auto', maxHeight: 620 }}>{children}</div>
    </div>
  );
}

interface JourneyBoardProps {
  data: LifecycleData;
  // Lead cards get their own action buttons (convert/close) only in the receptionist
  // view — the admin view renders leads read-only, so this stays optional.
  leadActions?: (lead: Lead) => ReactNode;
}

export default function JourneyBoard({ data, leadActions }: JourneyBoardProps) {
  return (
    <div className="flex gap-3" style={{ overflowX: 'auto', paddingBottom: 8 }}>
      <Column
        title="Leads"
        count={data.leads.length}
        color="var(--urgency-soon)"
        description="Primeiro contacto, ainda sem consulta marcada."
      >
        {data.leads.length === 0 ? (
          <Empty message="Sem leads abertos." />
        ) : (
          data.leads.map((lead) => (
            <div key={lead.id} className="card p-3 mb-2" style={{ border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>{lead.name}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {lead.phone ? formatPhonePT(lead.phone) : lead.email || '—'}
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {lead.source ? `${lead.source} · ` : ''}
                {String(lead.created_at).slice(0, 10)}
              </div>
              {leadActions?.(lead)}
            </div>
          ))
        )}
      </Column>

      {data.stages.map((s) => (
        <Column key={s.key} title={s.label} count={s.count} color={STAGE_COLOR[s.key]} description={s.description}>
          {s.patients.length === 0 ? (
            <Empty message="Sem pacientes." />
          ) : (
            s.patients.map((p) => <PatientCard key={p.id} p={p} />)
          )}
          {s.count > s.patients.length && (
            <div className="text-xs text-center mt-1" style={{ color: 'var(--text-muted)' }}>
              +{s.count - s.patients.length} não mostrados
            </div>
          )}
        </Column>
      ))}

      <Column
        title="Reativação"
        count={data.reactivationCandidates.length}
        color="var(--urgency-critical)"
        description="Desaparecidos, elegíveis para reativação — segmentados por tempo de ausência e valor histórico."
      >
        {data.reactivationCandidates.length === 0 ? (
          <Empty message="Sem candidatos a reativação." />
        ) : (
          data.reactivationCandidates.map((c) => (
            <div key={c.patientId} className="card p-3 mb-2" style={{ border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>{c.name}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {c.phone ? formatPhonePT(c.phone) : '—'}
              </div>
              <SegmentBadge segment={c.segment} />
            </div>
          ))
        )}
      </Column>
    </div>
  );
}
