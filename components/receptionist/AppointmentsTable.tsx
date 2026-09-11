'use client';
import type { AppSettings } from '@/app/providers';
import { Badge, RiskBadge, TD, TH } from '@/components/ui';
import type { Appointment } from '@/lib/types';

interface AppointmentsTableProps {
  rows: Appointment[];
  settings: AppSettings | null;
  removingId: string | null;
  onEdit: (a: Appointment) => void;
  onCancel: (a: Appointment) => void;
  onChangeStatus: (a: Appointment, nextStatus: string) => void;
  statusPending: Record<string, boolean>;
}

export default function AppointmentsTable({
  rows,
  settings,
  removingId,
  onEdit,
  onCancel,
  onChangeStatus,
  statusPending,
}: AppointmentsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <TH>Data</TH>
            <TH>Hora</TH>
            <TH>Doente</TH>
            <TH>Dentista</TH>
            <TH>Tipo</TH>
            <TH right>Cadeira</TH>
            <TH>Status</TH>
            <TH right>Ações</TH>
          </tr>
        </thead>
        <tbody>
          {!rows.length ? (
            <tr>
              <td className="data-td" colSpan={8} style={{ color: 'var(--text-secondary)' }}>
                Sem consultas neste intervalo.
              </td>
            </tr>
          ) : (
            rows.map((a) => {
              const pending = !!statusPending?.[a.id];
              return (
                <tr key={a.id}>
                  <TD mono>{String(a.appt_date || '').slice(0, 10)}</TD>
                  <TD mono>{String(a.start_time || '').slice(0, 5)}</TD>
                  <TD bold>
                    {a.patient_name || '—'}
                    {(a.risk_score || 0) >= 30 ? (
                      <span style={{ marginLeft: 10 }}>
                        <RiskBadge score={a.risk_score || 0} />
                      </span>
                    ) : null}
                  </TD>
                  <TD>{a.dentist_name || '—'}</TD>
                  <TD>{a.type || '—'}</TD>
                  <TD right mono>
                    {a.chair ?? '—'}
                  </TD>
                  <TD>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge s={a.status} />
                      <select
                        className="select"
                        value={a.status}
                        onChange={(e) => onChangeStatus(a, e.target.value)}
                        disabled={pending}
                        style={{ width: 'auto', padding: '6px 10px', fontSize: 12, opacity: pending ? 0.6 : 1 }}
                      >
                        <option value={a.status}>{a.status}</option>
                        {Array.from(new Set((settings?.STATUS_TRANSITIONS?.[a.status] || []) as string[])).map(
                          (s: string) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ),
                        )}
                      </select>
                    </div>
                  </TD>
                  <TD right>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(a)}>
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => onCancel(a)}
                        disabled={removingId === a.id}
                        style={{ opacity: removingId === a.id ? 0.7 : 1 }}
                      >
                        {removingId === a.id ? 'A cancelar…' : 'Cancelar'}
                      </button>
                    </div>
                  </TD>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
