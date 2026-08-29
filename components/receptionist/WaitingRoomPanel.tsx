import { Badge } from '@/components/ui';
import type { Appointment } from '@/lib/types';
import ChairGraphic, { CHAIR_COLORS } from './ChairGraphic';

const WAITING_SEATS = 8;

export default function WaitingRoomPanel({ waiting }: { waiting: Appointment[] }) {
  return (
    <div className="card" style={{ padding: '18px 18px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 900, color: '#172B4D' }}>Waiting Room</div>
          <div style={{ fontSize: 12, color: '#97A0AF' }}>
            {waiting.length} patient{waiting.length !== 1 ? 's' : ''} waiting
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
        {Array.from({ length: WAITING_SEATS }).map((_, i) => {
          const apt = waiting[i] || null;
          const color = CHAIR_COLORS[(Number(apt?.chair || 1) - 1) % CHAIR_COLORS.length] || CHAIR_COLORS[0];
          const occupied = !!apt;
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed waiting-room seat slots, not tied to a specific appointment's identity
              key={i}
              style={{
                border: '1px solid #EBECF0',
                borderRadius: 14,
                padding: '12px 12px 10px',
                background: 'white',
                display: 'flex',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <ChairGraphic color={color} occupied={occupied} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: occupied ? '#172B4D' : '#97A0AF',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {occupied ? apt.patient_name || '—' : 'Available'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#97A0AF',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {occupied ? `${String(apt.start_time || '').slice(0, 5)} · ${apt.type}` : '—'}
                </div>
                {occupied && apt.dentist_name && (
                  <div
                    style={{
                      fontSize: 11,
                      color: '#97A0AF',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {apt.dentist_name}
                  </div>
                )}
                {occupied && (
                  <div
                    style={{
                      marginTop: 6,
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <Badge s={apt.status} />
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {waiting.length > WAITING_SEATS && (
        <div style={{ marginTop: 10, fontSize: 12, color: '#97A0AF', fontWeight: 700 }}>
          +{waiting.length - WAITING_SEATS} waiting (not shown)
        </div>
      )}
    </div>
  );
}
