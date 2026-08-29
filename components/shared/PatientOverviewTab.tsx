import type { ReactNode } from 'react';
import { GhostBtn } from '@/components/ui';
import type { SchemaField } from './SchemaFieldInput';

export default function PatientOverviewTab({
  fields,
  customFields,
  schemaFields,
  onEditExtra,
}: {
  // Fixed profile fields to render as cards — callers pick their own set (e.g. the
  // dentist view surfaces no-show count where the receptionist view surfaces total visits).
  fields: Array<[string, ReactNode]>;
  customFields: Record<string, unknown> | null | undefined;
  schemaFields: SchemaField[];
  // Only the receptionist view offers editing extra fields from here; omit to hide the button.
  onEditExtra?: () => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {fields.map(([k, v]) => (
        <div key={k} className="card" style={{ padding: '14px 18px', boxShadow: 'none', border: '1px solid #DFE1E6' }}>
          <div className="section-label mb-1">{k}</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#172B4D' }}>{v}</div>
        </div>
      ))}
      {customFields && Object.keys(customFields).length > 0 && (
        <div
          className="card"
          style={{ padding: '14px 18px', boxShadow: 'none', border: '1px solid #DFE1E6', gridColumn: '1 / -1' }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 10,
            }}
          >
            <div className="section-label">Extra Fields</div>
            {onEditExtra && (
              <GhostBtn onClick={onEditExtra} style={{ padding: '6px 10px', fontSize: 12 }}>
                Edit
              </GhostBtn>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {Object.entries(customFields).map(([k, v]) => {
              const def = schemaFields.find((s) => s.field_name === k);
              return (
                <div key={k} style={{ border: '1px solid #F4F7FA', borderRadius: 8, padding: '10px 12px' }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: '#97A0AF',
                      fontWeight: 800,
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      marginBottom: 4,
                    }}
                  >
                    {def?.label || k}
                  </div>
                  <div style={{ fontSize: 13, color: '#172B4D', fontWeight: 600 }}>{String(v)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
