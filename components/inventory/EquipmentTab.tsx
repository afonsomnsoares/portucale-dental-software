'use client';
import { type ChangeEvent, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import {
  DataTable,
  Empty,
  ErrorState,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PrimaryBtn,
  Spinner,
  TD,
} from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';

interface ClinicEquipment {
  id: string;
  name: string;
  chair: number | null;
  tags: string[];
  active: boolean;
}

interface EquipmentTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
}

const EMPTY_FORM = { name: '', chair: '', tags: '' };

// Item 2/3's minimal equipment model — just enough for lib/scheduling.ts's
// suggestAppointmentSlots and lib/waitlist.ts's slot matching to know which chair carries
// which tagged equipment (see requiredEquipmentTags in lib/constants.ts). Not the full
// Categoria 14 (maintenance calendars, alerts, usage history).
export default function EquipmentTab({ api }: EquipmentTabProps) {
  const [modal, setModal] = useState<ClinicEquipment | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const itemsQuery = useQuery<ClinicEquipment[]>('/equipment');
  const items = itemsQuery.data ?? [];
  // Alias do refetch: as escritas deste ficheiro chamavam `load()` depois de
  // gravar, e continuam a poder fazê-lo.
  const load = itemsQuery.refetch;

  function openNew() {
    setForm(EMPTY_FORM);
    setError('');
    setModal('new');
  }
  function openEdit(it: ClinicEquipment) {
    setForm({ name: it.name, chair: it.chair ? String(it.chair) : '', tags: (it.tags || []).join(', ') });
    setError('');
    setModal(it);
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Nome é obrigatório.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        name: form.name.trim(),
        chair: form.chair ? Number(form.chair) : null,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => !!t),
      };
      if (modal === 'new') {
        await api('/equipment', { method: 'POST', body });
      } else if (modal) {
        await api(`/equipment/${modal.id}`, { method: 'PUT', body });
      }
      setModal(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao guardar equipamento.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(it: ClinicEquipment) {
    setError('');
    try {
      await api(`/equipment/${it.id}`, { method: 'PUT', body: { active: !it.active } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível mudar o estado do equipamento.');
    }
    load();
  }

  if (itemsQuery.error)
    return (
      <ErrorState error={itemsQuery.error} onRetry={itemsQuery.refetch} message="Não foi possível ler o equipamento." />
    );
  if (itemsQuery.loading) return <Spinner />;
  if (itemsQuery.error) return <ErrorState error={itemsQuery.error} onRetry={itemsQuery.refetch} />;

  return (
    <div>
      <div className="flex justify-end mb-3">
        <PrimaryBtn onClick={openNew}>+ Novo equipamento</PrimaryBtn>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {!items.length ? (
          <Empty message="Sem equipamento registado." />
        ) : (
          <DataTable
            cols={['Nome', 'Cadeira', 'Tags', 'Estado', '']}
            rows={items.map((it) => (
              <tr key={it.id} style={{ opacity: it.active ? 1 : 0.5 }}>
                <TD bold>{it.name}</TD>
                <TD muted>{it.chair ?? '—'}</TD>
                <TD muted>{it.tags.join(', ') || '—'}</TD>
                <TD>{it.active ? 'Ativo' : 'Inativo'}</TD>
                <TD right>
                  <GhostBtn
                    onClick={() => openEdit(it)}
                    style={{ padding: '5px 10px', fontSize: 'var(--text-xs)', marginRight: 8 }}
                  >
                    Editar
                  </GhostBtn>
                  <GhostBtn
                    onClick={() => toggleActive(it)}
                    style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}
                  >
                    {it.active ? 'Desativar' : 'Ativar'}
                  </GhostBtn>
                </TD>
              </tr>
            ))}
          />
        )}
      </div>

      {modal && (
        <Modal title={modal === 'new' ? 'Novo equipamento' : 'Editar equipamento'} onClose={() => setModal(null)}>
          <FormField label="Nome">
            <Inp
              value={form.name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ex: Aparelho de raio-X"
            />
          </FormField>
          <FormField label="Cadeira (opcional)" hint="Número da cadeira onde este equipamento está instalado">
            <Inp
              type="number"
              min={1}
              value={form.chair}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, chair: e.target.value }))}
            />
          </FormField>
          <FormField label="Tags (separadas por vírgula)" hint="ex: xray, endo_motor, whitening_lamp">
            <Inp
              value={form.tags}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, tags: e.target.value }))}
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
          <div className="flex gap-3 mt-4">
            <PrimaryBtn onClick={save} disabled={saving} style={{ flex: 1, justifyContent: 'center' }}>
              {saving ? 'A guardar…' : 'Guardar'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(null)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
