'use client';
import { type ChangeEvent, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import {
  Badge,
  Empty,
  ErrorState,
  FormField,
  GhostBtn,
  Modal,
  PrimaryBtn,
  Sel,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { ChecklistTemplate, ChecklistType } from '@/lib/types';

interface TemplateManagerProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  tenantId?: string;
}

const TYPE_LABEL: Record<string, string> = { opening: 'Abertura', closing: 'Fecho', other: 'Outro' };
const EMPTY_FORM = { name: '', type: 'opening' as ChecklistType, itemsText: '' };

// Admin-only: create/edit/deactivate checklist templates. Items are edited as one item per
// line in a textarea rather than a dynamic list-of-inputs — simpler to build and to use
// for what's typically a short, rarely-changed list (5-15 items).
export default function TemplateManager({ api, tenantId }: TemplateManagerProps) {
  const [modal, setModal] = useState<ChecklistTemplate | null | 'new'>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const qs = tenantId ? `?active=false&tenantId=${tenantId}` : '?active=false';
  const templatesQuery = useQuery<ChecklistTemplate[]>(`/checklist-templates${qs}`);
  const templates = templatesQuery.data ?? [];
  // Alias do refetch: as escritas deste ficheiro chamavam `load()` depois de
  // gravar, e continuam a poder fazê-lo.
  const load = templatesQuery.refetch;

  function openNew() {
    setForm(EMPTY_FORM);
    setError('');
    setModal('new');
  }

  function openEdit(t: ChecklistTemplate) {
    setForm({ name: t.name, type: t.type, itemsText: t.items.join('\n') });
    setError('');
    setModal(t);
  }

  async function save() {
    const items = form.itemsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!form.name.trim() || !items.length) {
      setError('Nome e pelo menos um item são obrigatórios.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (modal === 'new') {
        await api('/checklist-templates', {
          method: 'POST',
          body: { name: form.name, type: form.type, items, ...(tenantId ? { tenantId } : {}) },
        });
      } else if (modal) {
        await api(`/checklist-templates/${modal.id}`, {
          method: 'PUT',
          body: { name: form.name, type: form.type, items },
        });
      }
      setModal(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao guardar checklist.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(t: ChecklistTemplate) {
    setBusyId(t.id);
    setError('');
    try {
      await api(`/checklist-templates/${t.id}`, { method: 'PUT', body: { active: !t.active } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível mudar o estado do modelo.');
    }
    setBusyId(null);
    load();
  }

  if (templatesQuery.error)
    return (
      <ErrorState
        error={templatesQuery.error}
        onRetry={templatesQuery.refetch}
        message="Não foi possível ler os modelos."
      />
    );
  if (templatesQuery.loading) return <Spinner />;
  if (templatesQuery.error) return <ErrorState error={templatesQuery.error} onRetry={templatesQuery.refetch} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="section-label">MODELOS DE CHECKLIST</div>
        <PrimaryBtn onClick={openNew}>+ Nova checklist</PrimaryBtn>
      </div>
      {!templates.length ? (
        <Empty message="Sem checklists configuradas." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between"
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-control)',
                padding: '10px 12px',
                opacity: t.active ? 1 : 0.55,
              }}
            >
              <div>
                <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>{t.name}</span>
                <Badge label={TYPE_LABEL[t.type]} bg="var(--bg-sunken)" color="var(--text-secondary)" />
                <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                  {t.items.length} itens
                </span>
                {!t.active && <Badge label="Inativa" bg="var(--urgency-critical-bg)" color="var(--urgency-critical)" />}
              </div>
              <div className="flex items-center gap-2">
                <GhostBtn onClick={() => openEdit(t)} style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}>
                  Editar
                </GhostBtn>
                <GhostBtn
                  disabled={busyId === t.id}
                  onClick={() => toggleActive(t)}
                  style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}
                >
                  {t.active ? 'Desativar' : 'Ativar'}
                </GhostBtn>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title={modal === 'new' ? 'Nova checklist' : `Editar — ${modal.name}`} onClose={() => setModal(null)}>
          <FormField label="Nome">
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ex: Abertura da manhã"
            />
          </FormField>
          <FormField label="Tipo">
            <Sel value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ChecklistType }))}>
              <option value="opening">Abertura</option>
              <option value="closing">Fecho</option>
              <option value="other">Outro</option>
            </Sel>
          </FormField>
          <FormField label="Itens (um por linha)">
            <Textarea
              value={form.itemsText}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm((f) => ({ ...f, itemsText: e.target.value }))}
              style={{ minHeight: 140 }}
              placeholder={'Ligar compressor\nVerificar stock de luvas\n...'}
            />
          </FormField>
          {error && (
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--urgency-critical)',
                fontWeight: 'var(--weight-bold)',
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setModal(null)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={save} disabled={saving}>
              {saving ? 'A guardar…' : 'Guardar'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
