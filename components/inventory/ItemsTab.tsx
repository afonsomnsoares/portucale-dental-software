'use client';
import { type ChangeEvent, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import {
  DataTable,
  Empty,
  ErrorState,
  FormField,
  GhostBtn,
  Modal,
  PrimaryBtn,
  Sel,
  Spinner,
  TD,
  Textarea,
} from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { InventoryItem, InventoryMovementReason } from '@/lib/types';

interface ItemsTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  tenantId: string;
  // Notifies the parent page after a create/edit so its own item list (shared with the
  // Ledger tab and the Encomendas item picker) doesn't go stale.
  onChanged?: () => void;
}

const REASON_LABEL: Record<InventoryMovementReason, string> = {
  received: 'Receção de stock',
  consumed: 'Consumo',
  adjusted: 'Ajuste (correção)',
  wastage: 'Quebra',
  expired: 'Expirado',
};

const EMPTY_ITEM_FORM = { item: '', unit: 'un', reorderAt: '10' };
const EMPTY_MOVE_FORM = {
  reason: 'received' as InventoryMovementReason,
  quantity: '1',
  batchNumber: '',
  expiryDate: '',
  notes: '',
};

// The master catalog (inventory_items) — previously had no create/edit UI at all, only
// app/api/inventory's PUT for setting a tenant's quantity on an item that had to already
// exist. Creating an item here, then "Registar movimento" on it, is what makes the
// Previsão/Encomendas tabs have anything to show for a brand new clinic.
export default function ItemsTab({ api, tenantId, onChanged }: ItemsTabProps) {
  const [itemModal, setItemModal] = useState<InventoryItem | 'new' | null>(null);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [moveTarget, setMoveTarget] = useState<InventoryItem | null>(null);
  const [moveForm, setMoveForm] = useState(EMPTY_MOVE_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const itemsQuery = useQuery<InventoryItem[]>('/inventory/items');
  const items = itemsQuery.data ?? [];
  // Alias do refetch: as escritas deste ficheiro chamavam `load()` depois de
  // gravar, e continuam a poder fazê-lo.
  const load = itemsQuery.refetch;

  function openNewItem() {
    setItemForm(EMPTY_ITEM_FORM);
    setError('');
    setItemModal('new');
  }
  function openEditItem(it: InventoryItem) {
    setItemForm({ item: it.item, unit: it.unit, reorderAt: String(it.reorder_at) });
    setError('');
    setItemModal(it);
  }

  async function saveItem() {
    if (!itemForm.item.trim()) {
      setError('Nome é obrigatório.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = { item: itemForm.item, unit: itemForm.unit, reorderAt: Number(itemForm.reorderAt) || 0 };
      if (itemModal === 'new') {
        await api('/inventory/items', { method: 'POST', body });
      } else if (itemModal) {
        await api(`/inventory/items/${itemModal.id}`, { method: 'PUT', body });
      }
      setItemModal(null);
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao guardar item.');
    } finally {
      setSaving(false);
    }
  }

  function openMove(it: InventoryItem) {
    setMoveForm(EMPTY_MOVE_FORM);
    setError('');
    setMoveTarget(it);
  }

  async function saveMove() {
    if (!moveTarget) return;
    const qty = Number(moveForm.quantity);
    if (!qty || qty <= 0) {
      setError('Quantidade tem de ser positiva.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api('/inventory/movements', {
        method: 'POST',
        body: {
          tenantId,
          itemId: moveTarget.id,
          reason: moveForm.reason,
          delta: moveForm.reason === 'received' ? qty : -qty,
          batchNumber: moveForm.reason === 'received' ? moveForm.batchNumber : undefined,
          expiryDate: moveForm.reason === 'received' ? moveForm.expiryDate || undefined : undefined,
          notes: moveForm.notes,
        },
      });
      setMoveTarget(null);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao registar movimento.');
    } finally {
      setSaving(false);
    }
  }

  if (itemsQuery.error)
    return (
      <ErrorState error={itemsQuery.error} onRetry={itemsQuery.refetch} message="Não foi possível ler o inventário." />
    );
  if (itemsQuery.loading) return <Spinner />;
  if (itemsQuery.error) return <ErrorState error={itemsQuery.error} onRetry={itemsQuery.refetch} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="section-label">CATÁLOGO DE ITENS</div>
        <PrimaryBtn onClick={openNewItem}>+ Novo item</PrimaryBtn>
      </div>

      {!items.length ? (
        <Empty message="Sem itens no catálogo." />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            cols={['Artigo', 'Unidade', 'Ponto de reposição', '']}
            rows={items.map((it) => (
              <tr key={it.id}>
                <TD bold>{it.item}</TD>
                <TD muted>{it.unit}</TD>
                <TD>{it.reorder_at}</TD>
                <TD right>
                  <div className="flex items-center justify-end gap-2">
                    <GhostBtn onClick={() => openEditItem(it)} style={{ padding: '5px 10px', fontSize: 12 }}>
                      Editar
                    </GhostBtn>
                    <PrimaryBtn
                      onClick={() => openMove(it)}
                      disabled={!tenantId}
                      style={{ padding: '5px 10px', fontSize: 12 }}
                    >
                      Registar movimento
                    </PrimaryBtn>
                  </div>
                </TD>
              </tr>
            ))}
          />
        </div>
      )}

      {itemModal && (
        <Modal
          title={itemModal === 'new' ? 'Novo item' : `Editar — ${itemModal.item}`}
          onClose={() => setItemModal(null)}
        >
          <FormField label="Nome">
            <input
              className="input"
              value={itemForm.item}
              onChange={(e) => setItemForm((f) => ({ ...f, item: e.target.value }))}
              placeholder="Ex: Luvas de nitrilo (M)"
            />
          </FormField>
          <div className="grid-pair" style={{ gap: 12 }}>
            <FormField label="Unidade">
              <input
                className="input"
                value={itemForm.unit}
                onChange={(e) => setItemForm((f) => ({ ...f, unit: e.target.value }))}
                placeholder="un, caixa, ml..."
              />
            </FormField>
            <FormField label="Ponto de reposição">
              <input
                type="number"
                min={0}
                className="input"
                value={itemForm.reorderAt}
                onChange={(e) => setItemForm((f) => ({ ...f, reorderAt: e.target.value }))}
              />
            </FormField>
          </div>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--urgency-critical)', fontWeight: 700, marginBottom: 10 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setItemModal(null)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={saveItem} disabled={saving}>
              {saving ? 'A guardar…' : 'Guardar'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}

      {moveTarget && (
        <Modal title={`Registar movimento — ${moveTarget.item}`} onClose={() => setMoveTarget(null)}>
          <FormField label="Tipo">
            <Sel
              value={moveForm.reason}
              onChange={(e) => setMoveForm((f) => ({ ...f, reason: e.target.value as InventoryMovementReason }))}
            >
              {Object.entries(REASON_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label={`Quantidade (${moveTarget.unit})`}>
            <input
              type="number"
              min={1}
              className="input"
              value={moveForm.quantity}
              onChange={(e) => setMoveForm((f) => ({ ...f, quantity: e.target.value }))}
            />
          </FormField>
          {moveForm.reason === 'received' && (
            <div className="grid-pair" style={{ gap: 12 }}>
              <FormField label="Nº de lote (opcional)">
                <input
                  className="input"
                  value={moveForm.batchNumber}
                  onChange={(e) => setMoveForm((f) => ({ ...f, batchNumber: e.target.value }))}
                />
              </FormField>
              <FormField label="Data de validade (opcional)">
                <input
                  type="date"
                  className="input"
                  value={moveForm.expiryDate}
                  onChange={(e) => setMoveForm((f) => ({ ...f, expiryDate: e.target.value }))}
                />
              </FormField>
            </div>
          )}
          <FormField label="Notas (opcional)">
            <Textarea
              value={moveForm.notes}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setMoveForm((f) => ({ ...f, notes: e.target.value }))}
              style={{ minHeight: 60 }}
            />
          </FormField>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--urgency-critical)', fontWeight: 700, marginBottom: 10 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setMoveTarget(null)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={saveMove} disabled={saving}>
              {saving ? 'A registar…' : 'Registar'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
