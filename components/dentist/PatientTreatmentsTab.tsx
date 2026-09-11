import { Badge, Empty } from '@/components/ui';
import type { Treatment } from '@/lib/types';

export default function PatientTreatmentsTab({ treatments }: { treatments: Treatment[] }) {
  return (
    <div className="card p-5">
      <div className="section-label mb-4">HISTÓRICO DE TRATAMENTOS</div>
      {!treatments.length ? (
        <Empty message="Sem tratamentos registados." />
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
                fontSize: 'var(--text-2xs)',
                fontWeight: 'var(--weight-bold)',
                color: 'var(--accent)',
              }}
            >
              {t.treatment_code || '—'}
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--text-primary)',
                }}
              >
                {t.description}
              </div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                {t.treatment_code || '—'} · Fase {t.phase}
              </div>
            </div>
            <Badge s={t.status} />
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--text-primary)' }}>
              ${Number(t.fee).toLocaleString()}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
