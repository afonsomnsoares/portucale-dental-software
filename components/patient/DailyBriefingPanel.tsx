'use client';
import { useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { Empty, GhostBtn } from '@/components/ui';
import type { DailyBriefingRow } from '@/lib/types';

interface DailyBriefingPanelProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  rows: DailyBriefingRow[];
}

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmada',
  registered: 'Registada',
  waiting: 'A aguardar',
  'in-operatory': 'Em consultório',
  'procedure-active': 'Procedimento',
  'ready-dismissal': 'Pronto p/ saída',
  departed: 'Saiu',
  'no-show': 'Não compareceu',
};

const ACTION_COLOR: Record<string, { bg: string; color: string }> = {
  MISSING_DATA: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  OPEN_TASKS: { bg: 'var(--accent-bg)', color: 'var(--accent)' },
  PLAN_NOT_ACCEPTED: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  REACTIVATE: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  NO_UPCOMING_VISIT: { bg: 'var(--accent-bg)', color: 'var(--accent)' },
};

export default function DailyBriefingPanel({ api, rows }: DailyBriefingPanelProps) {
  const [taskCreatedFor, setTaskCreatedFor] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  async function createFollowUp(row: DailyBriefingRow) {
    setBusyId(row.appointmentId);
    const created = await api('/patient-tasks', {
      method: 'POST',
      body: {
        patientId: row.patientId,
        type: 'follow_up',
        title: `Follow-up pós-consulta: ${row.patientName}`,
        notes: row.nextAction.label,
      },
    }).catch(() => null);
    if (created) setTaskCreatedFor((prev) => new Set(prev).add(row.appointmentId));
    setBusyId(null);
  }

  if (!rows.length) return <Empty message="Sem consultas marcadas para este dia." />;

  return (
    <div className="card p-5">
      <div className="section-label mb-1">PREPARAÇÃO DE HOJE</div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Dados em falta, tarefas pendentes e o que fazer a seguir, por paciente — sem tocar em nada clínico.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => {
          const needsFollowUp =
            r.appointmentStatus === 'departed' && !r.hasUpcomingAppointment && r.nextAction.code !== 'UP_TO_DATE';
          const actionColor = ACTION_COLOR[r.nextAction.code] || {
            bg: 'var(--bg-sunken)',
            color: 'var(--text-secondary)',
          };
          return (
            <div
              key={r.appointmentId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-control)',
                padding: '10px 14px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{String(r.startTime).slice(0, 5)}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{r.patientName}</span>
                  <span
                    className="badge"
                    style={{ background: 'var(--bg-sunken)', color: 'var(--text-secondary)', fontSize: 10 }}
                  >
                    {STATUS_LABEL[r.appointmentStatus] || r.appointmentStatus}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {r.missingFields.length > 0 && (
                    <span
                      className="text-xs"
                      style={{
                        background: 'var(--urgency-soon-bg)',
                        color: 'var(--urgency-soon)',
                        borderRadius: 'var(--radius-control)',
                        padding: '2px 8px',
                        fontWeight: 600,
                      }}
                    >
                      Dados em falta: {r.missingFields.map((f) => f.label).join(', ')}
                    </span>
                  )}
                  {r.openTaskCount > 0 && (
                    <span
                      className="text-xs"
                      style={{
                        background: 'var(--accent-bg)',
                        color: 'var(--accent)',
                        borderRadius: 'var(--radius-control)',
                        padding: '2px 8px',
                        fontWeight: 600,
                      }}
                    >
                      {r.openTaskCount} tarefa{r.openTaskCount > 1 ? 's' : ''} em aberto
                    </span>
                  )}
                  {r.nextAction.code !== 'UP_TO_DATE' && (
                    <span
                      className="text-xs"
                      style={{
                        background: actionColor.bg,
                        color: actionColor.color,
                        borderRadius: 'var(--radius-control)',
                        padding: '2px 8px',
                        fontWeight: 600,
                      }}
                    >
                      {r.nextAction.label}
                    </span>
                  )}
                </div>
              </div>

              {needsFollowUp &&
                (taskCreatedFor.has(r.appointmentId) ? (
                  <span className="text-xs" style={{ color: 'var(--urgency-ok)', fontWeight: 700, flexShrink: 0 }}>
                    Tarefa criada
                  </span>
                ) : (
                  <GhostBtn
                    disabled={busyId === r.appointmentId}
                    onClick={() => createFollowUp(r)}
                    style={{ padding: '5px 10px', fontSize: 12, flexShrink: 0 }}
                  >
                    {busyId === r.appointmentId ? '…' : 'Criar follow-up'}
                  </GhostBtn>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
