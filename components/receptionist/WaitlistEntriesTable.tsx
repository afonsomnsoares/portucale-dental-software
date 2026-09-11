import { Badge, Empty, GhostBtn } from '@/components/ui';
import { formatPhonePT } from '@/lib/constants';
import type { WaitlistEntry } from '@/lib/types';
import { WAITLIST_STATUS_LABEL, WEEKDAYS } from './scheduleIntelConstants';

export default function WaitlistEntriesTable({
  entries,
  busyId,
  onCancel,
}: {
  entries: WaitlistEntry[];
  busyId: string | null;
  onCancel: (entry: WaitlistEntry) => void;
}) {
  if (!entries.length) return <Empty message="Sem doentes na lista de espera." />;
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="table-scroll">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="data-th">Doente</th>
              <th className="data-th">Contacto</th>
              <th className="data-th">Tratamento</th>
              <th className="data-th">Preferências</th>
              <th className="data-th">Estado</th>
              <th className="data-th" style={{ textAlign: 'right' }}>
                Ação
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((w) => (
              <tr key={w.id} style={{ borderBottom: '1px solid var(--bg-page)' }}>
                <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                  {w.patient_name}
                </td>
                <td className="data-td">{w.phone ? <a href={`tel:${w.phone}`}>{formatPhonePT(w.phone)}</a> : '—'}</td>
                <td className="data-td">{w.treatment_type}</td>
                <td className="data-td text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {w.preferred_days?.length
                    ? w.preferred_days.map((d) => WEEKDAYS.find((x) => x.key === d)?.label || d).join(', ')
                    : 'Qualquer dia'}
                  {w.preferred_time_start
                    ? ` · ${w.preferred_time_start.slice(0, 5)}-${w.preferred_time_end?.slice(0, 5) || ''}`
                    : ''}
                </td>
                <td className="data-td">
                  <Badge
                    label={WAITLIST_STATUS_LABEL[w.status] || w.status}
                    bg="var(--bg-sunken)"
                    color="var(--text-secondary)"
                  />
                </td>
                <td className="data-td" style={{ textAlign: 'right' }}>
                  {(w.status === 'active' || w.status === 'offered') && (
                    <GhostBtn disabled={busyId === w.id} onClick={() => onCancel(w)} style={{ padding: '5px 10px' }}>
                      {busyId === w.id ? '…' : 'Cancelar'}
                    </GhostBtn>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
