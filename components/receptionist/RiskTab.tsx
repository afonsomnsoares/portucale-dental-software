import { Empty, GhostBtn, RiskBadge } from '@/components/ui';
import { formatPhonePT } from '@/lib/constants';
import type { RiskAppointment } from '@/lib/types';

export default function RiskTab({ appointments }: { appointments: RiskAppointment[] }) {
  if (!appointments.length) return <Empty message="Sem consultas nos próximos 14 dias." />;
  return (
    <div className="card" style={{ padding: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th className="data-th">Doente</th>
            <th className="data-th">Contacto</th>
            <th className="data-th">Consulta</th>
            <th className="data-th">Risco</th>
            <th className="data-th" style={{ textAlign: 'right' }}>
              Ação
            </th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((a) => (
            <tr key={a.id} style={{ borderBottom: '1px solid #F4F7FA' }}>
              <td className="data-td" style={{ fontWeight: 600 }}>
                {a.patient_name}
              </td>
              <td className="data-td">{a.phone ? <a href={`tel:${a.phone}`}>{formatPhonePT(a.phone)}</a> : '—'}</td>
              <td className="data-td" style={{ color: 'var(--ink-2)' }}>
                {String(a.appt_date).slice(0, 10)} · {String(a.start_time).slice(0, 5)} · {a.type}
              </td>
              <td className="data-td">
                <RiskBadge score={a.score} />
              </td>
              <td className="data-td" style={{ textAlign: 'right' }}>
                {a.phone && (
                  <GhostBtn
                    onClick={() => {
                      window.location.href = `tel:${a.phone}`;
                    }}
                    style={{ padding: '5px 10px' }}
                  >
                    Contactar
                  </GhostBtn>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
