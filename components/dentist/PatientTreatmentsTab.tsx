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
              borderBottom: '1px solid var(--bg-page)',
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 'var(--radius-control)',
                background: 'var(--accent-bg)',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--accent)',
              }}
            >
              {t.treatment_code || '—'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t.description}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {t.treatment_code || '—'} · Phase {t.phase}
              </div>
            </div>
            <Badge s={t.status} />
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              ${Number(t.fee).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
