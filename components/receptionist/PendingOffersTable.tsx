import { GhostBtn, PrimaryBtn } from '@/components/ui';
import { formatPhonePT } from '@/lib/constants';
import type { SlotOffer } from '@/lib/types';

export default function PendingOffersTable({
  offers,
  busyId,
  onRespond,
  patientName,
}: {
  offers: SlotOffer[];
  busyId: string | null;
  onRespond: (offer: SlotOffer, action: 'book' | 'decline') => void;
  patientName: (id: string) => string;
}) {
  if (!offers.length) return null;
  return (
    <div className="mb-6">
      <div className="section-label mb-2">Ofertas pendentes</div>
      <div className="card" style={{ padding: 0 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="data-th">Doente</th>
              <th className="data-th">Contacto</th>
              <th className="data-th">Tratamento</th>
              <th className="data-th">Horário oferecido</th>
              <th className="data-th" style={{ textAlign: 'right' }}>
                Ação
              </th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              <tr key={o.id} style={{ borderBottom: '1px solid #F4F7FA' }}>
                <td className="data-td" style={{ fontWeight: 600 }}>
                  {o.patient_name || patientName(o.patient_id || '')}
                </td>
                <td className="data-td">{o.phone ? <a href={`tel:${o.phone}`}>{formatPhonePT(o.phone)}</a> : '—'}</td>
                <td className="data-td">{o.treatment_type}</td>
                <td className="data-td" style={{ color: 'var(--ink-2)' }}>
                  {String(o.offered_date).slice(0, 10)} · {String(o.offered_start_time).slice(0, 5)}
                </td>
                <td className="data-td" style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <PrimaryBtn
                      disabled={busyId === o.id}
                      onClick={() => onRespond(o, 'book')}
                      style={{ padding: '5px 10px' }}
                    >
                      {busyId === o.id ? '…' : 'Confirmar marcação'}
                    </PrimaryBtn>
                    <GhostBtn
                      disabled={busyId === o.id}
                      onClick={() => onRespond(o, 'decline')}
                      style={{ padding: '5px 10px' }}
                    >
                      Recusar
                    </GhostBtn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
