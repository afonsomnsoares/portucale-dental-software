import { AlertTriangle } from 'lucide-react';
import { Avatar, Badge, RiskBadge } from '@/components/ui';
import type { Patient } from '@/lib/types';

export default function PatientDetailHeader({
  patient,
  avatarSize = 48,
  balanceLabel = 'Outstanding balance',
  showVisitCount = false,
}: {
  patient: Patient;
  avatarSize?: number;
  balanceLabel?: string;
  showVisitCount?: boolean;
}) {
  return (
    <div className="card p-5 mb-4">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Avatar name={patient.name} size={avatarSize} color="#0052CC" />
          <div>
            <div
              style={{ fontSize: 20, fontWeight: 800, color: '#172B4D', fontFamily: '"Plus Jakarta Sans",sans-serif' }}
            >
              {patient.name}
            </div>
            <div style={{ fontSize: 12, color: '#97A0AF', marginBottom: 6 }}>
              Global ID #{patient.global_seq} · {patient.dob?.slice(0, 10) || '—'} · {patient.insurance || '—'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge s={patient.status} />
              <RiskBadge score={patient.no_show_score || 0} />
              {showVisitCount && (
                <span style={{ fontSize: 11, color: '#97A0AF' }}>{patient.visit_count || 0} visits</span>
              )}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: Number(patient.balance) > 0 ? '#FF8B00' : '#00875A',
              fontFamily: '"Plus Jakarta Sans",sans-serif',
            }}
          >
            ${Number(patient.balance || 0).toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: '#97A0AF' }}>{balanceLabel}</div>
        </div>
      </div>
      {patient.alerts?.filter(Boolean).length > 0 && (
        <div
          style={{
            background: '#FFEBE6',
            border: '1px solid #FFBDAD',
            borderRadius: 6,
            padding: '8px 14px',
            marginTop: 12,
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {patient.alerts.filter(Boolean).map((a) => (
            <span
              key={a}
              style={{ fontSize: 12, color: '#DE350B', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <AlertTriangle size={12} />
              {a}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
