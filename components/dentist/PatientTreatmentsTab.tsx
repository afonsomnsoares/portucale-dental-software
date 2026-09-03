import { Badge, Empty } from '@/components/ui';
import type { Treatment } from '@/lib/types';

export default function PatientTreatmentsTab({ treatments }: { treatments: Treatment[] }) {
  return (
    <div className="card p-5">
      <div className="section-label mb-4">TREATMENT HISTORY</div>
      {!treatments.length ? (
        <Empty message="No treatments recorded." />
      ) : (
        treatments.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              padding: '12px 0',
              borderBottom: '1px solid #F4F7FA',
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: '#DEEBFF',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                color: '#0052CC',
              }}
            >
              {t.treatment_code || '—'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#172B4D' }}>{t.description}</div>
              <div style={{ fontSize: 11, color: '#97A0AF' }}>
                {t.treatment_code || '—'} · Phase {t.phase}
              </div>
            </div>
            <Badge s={t.status} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#172B4D' }}>${Number(t.fee).toLocaleString()}</div>
          </div>
        ))
      )}
    </div>
  );
}
