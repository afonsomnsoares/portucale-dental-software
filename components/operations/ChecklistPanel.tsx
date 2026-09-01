'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { Badge, Empty, PrimaryBtn, Spinner } from '@/components/ui';
import type { ChecklistRun, ChecklistTemplate } from '@/lib/types';

interface ChecklistPanelProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  tenantId?: string;
}

const TYPE_LABEL: Record<string, string> = { opening: 'Abertura', closing: 'Fecho', other: 'Outro' };

// Self-service checklist runner: shows every active template and, for each, either "not
// started today" (with a button to start it) or its live progress with checkboxes. Used
// as-is by admin/receptionist/dentist — running a checklist needs no special permission
// (see app/api/checklist-runs/route.ts), only managing templates does.
export default function ChecklistPanel({ api, tenantId }: ChecklistPanelProps) {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [runs, setRuns] = useState<ChecklistRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const qs = tenantId ? `?tenantId=${tenantId}` : '';

  const load = useCallback(async () => {
    setLoading(true);
    const [t, r] = await Promise.all([
      api(`/checklist-templates${qs}`).catch(() => []),
      api(`/checklist-runs${qs}`).catch(() => []),
    ]);
    setTemplates(t || []);
    setRuns(r || []);
    setLoading(false);
  }, [api, qs]);

  useEffect(() => {
    load();
  }, [load]);

  async function startRun(templateId: string) {
    setBusyId(templateId);
    try {
      await api('/checklist-runs', { method: 'POST', body: { templateId, ...(tenantId ? { tenantId } : {}) } });
    } catch {
      // most likely a 409 (already started by someone else in the meantime) — just reload
    }
    setBusyId(null);
    load();
  }

  async function toggle(run: ChecklistRun, index: number, checked: boolean) {
    setBusyId(run.id);
    await api(`/checklist-runs/${run.id}`, { method: 'PUT', body: { index, checked } }).catch(() => null);
    setBusyId(null);
    load();
  }

  if (loading) return <Spinner />;

  if (!templates.length) {
    return <Empty message="Sem checklists configuradas." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {templates.map((t) => {
        const run = runs.find((r) => r.template_id === t.id);
        const checkedCount = run ? run.items.filter((i) => i.checked).length : 0;
        return (
          <div key={t.id} className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</span>
                <Badge label={TYPE_LABEL[t.type]} bg="var(--surface-2)" color="var(--ink-2)" />
              </div>
              {run ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                    {checkedCount}/{run.items.length}
                  </span>
                  {run.status === 'completed' && <Badge label="Concluída" bg="var(--green-bg)" color="var(--green)" />}
                </div>
              ) : (
                <PrimaryBtn
                  onClick={() => startRun(t.id)}
                  disabled={busyId === t.id}
                  style={{ padding: '5px 12px', fontSize: 12 }}
                >
                  Iniciar
                </PrimaryBtn>
              )}
            </div>
            {run && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {run.items.map((item, i) => (
                  <label
                    key={`${run.id}-${item.label}`}
                    className="flex items-center gap-2"
                    style={{ fontSize: 13, cursor: run.status === 'completed' ? 'default' : 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={item.checked}
                      disabled={busyId === run.id}
                      onChange={(e) => toggle(run, i, e.target.checked)}
                    />
                    <span
                      style={{
                        textDecoration: item.checked ? 'line-through' : 'none',
                        color: item.checked ? 'var(--ink-3)' : 'var(--ink)',
                      }}
                    >
                      {item.label}
                    </span>
                    {item.checked && item.checkedByName && (
                      <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                        — {item.checkedByName}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
