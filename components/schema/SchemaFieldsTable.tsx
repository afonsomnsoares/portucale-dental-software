import { Check } from 'lucide-react';
import { Badge, Spinner } from '@/components/ui';

export interface SchemaFieldRow {
  id: number;
  field_name: string;
  label?: string | null;
  description?: string | null;
  field_type: string;
  enum_values?: unknown;
  rollout: number;
  required: boolean;
  pushed_at?: string | null;
}

export default function SchemaFieldsTable({
  fields,
  loading,
  tenantId,
  onEdit,
  onDeploy,
}: {
  fields: SchemaFieldRow[];
  loading: boolean;
  tenantId: string;
  onEdit: (field: SchemaFieldRow) => void;
  onDeploy: (id: number) => void;
}) {
  return (
    <div className="card" style={{ padding: 0 }}>
      {loading ? (
        <Spinner />
      ) : !tenantId ? (
        <div style={{ padding: 18, fontSize: 13, color: 'var(--text-muted)' }}>
          Select a clinic to manage its schema fields.
        </div>
      ) : (
        <div className="table-scroll">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className="data-th">Field</th>
                <th className="data-th">Tipo</th>
                <th className="data-th">Rollout</th>
                <th className="data-th">Required</th>
                <th className="data-th">Published</th>
                <th className="data-th"></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.id}>
                  <td className="data-td">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>
                        {f.label || f.field_name}
                      </div>
                      <code
                        style={{
                          background: 'var(--cat-purple-bg)',
                          color: 'var(--cat-purple)',
                          borderRadius: 'var(--radius-control)',
                          padding: '2px 8px',
                          fontSize: 11,
                          fontFamily: '"JetBrains Mono",monospace',
                          fontWeight: 600,
                          width: 'fit-content',
                        }}
                      >
                        {f.field_name}
                      </code>
                      {f.description && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{f.description}</div>}
                    </div>
                  </td>
                  <td className="data-td" style={{ color: 'var(--text-secondary)' }}>
                    {f.field_type}
                  </td>
                  <td className="data-td">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 80,
                          height: 5,
                          background: 'var(--bg-page)',
                          borderRadius: 'var(--radius-pill)',
                        }}
                      >
                        <div
                          style={{
                            width: `${f.rollout}%`,
                            height: '100%',
                            borderRadius: 'var(--radius-pill)',
                            background: f.rollout === 100 ? 'var(--urgency-ok)' : 'var(--urgency-soon)',
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          fontFamily: '"JetBrains Mono",monospace',
                        }}
                      >
                        {f.rollout}%
                      </span>
                    </div>
                  </td>
                  <td className="data-td">
                    <Badge s={f.required ? 'completed' : 'proposed'} label={f.required ? 'Required' : 'Optional'} />
                  </td>
                  <td className="data-td" style={{ color: 'var(--text-muted)' }}>
                    {f.pushed_at?.slice(0, 10) || '—'}
                  </td>
                  <td className="data-td">
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <button type="button" onClick={() => onEdit(f)} className="btn btn-secondary btn-sm">
                        Edit
                      </button>
                      {f.rollout < 100 ? (
                        <button type="button" onClick={() => onDeploy(f.id)} className="btn btn-primary btn-sm">
                          Publish
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--urgency-ok)', fontWeight: 700 }}>
                          <Check size={12} style={{ display: 'inline' }} /> Live
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
