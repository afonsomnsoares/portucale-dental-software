'use client';
import { useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { Badge, Empty, ErrorState, FormField, GhostBtn, Modal, PrimaryBtn, Sel, Spinner, TD } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { formatEUR } from '@/lib/constants';
import type { InventoryItem, PurchaseOrder } from '@/lib/types';

interface PurchaseOrdersTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  tenantId: string;
  items: InventoryItem[];
  // Receiving an order changes inventory_stock (see lib/inventory.ts's
  // receivePurchaseOrder) — notifies the parent page so the Ledger tab's stock figures
  // don't go stale.
  onReceived?: () => void;
}

const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  draft: { label: 'Rascunho', bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' },
  ordered: { label: 'Encomendado', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  received: { label: 'Recebido', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  cancelled: { label: 'Cancelado', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
};

type DraftLine = { key: string; itemId: string; quantity: string };

function newLine(itemId = ''): DraftLine {
  return { key: crypto.randomUUID(), itemId, quantity: '1' };
}

// "Automação de encomendas" nesta fase: lib/jobsRunner.ts's 'reorderSuggestions' job (ver
// botão "Gerar sugestões" abaixo) propõe sozinho um rascunho com os itens em risco de
// rutura — não há integração real com fornecedores, por isso marcar como
// encomendado/recebido continua a ser uma ação humana. Uma encomenda manual segue o mesmo
// fluxo, só que criada por uma pessoa em vez do job.
export default function PurchaseOrdersTab({ api, tenantId, items, onReceived }: PurchaseOrdersTabProps) {
  const ordersQuery = useQuery<PurchaseOrder[]>(tenantId ? `/purchase-orders?tenantId=${tenantId}` : null);
  const orders = ordersQuery.data ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = ordersQuery.refetch;

  async function generateSuggestions() {
    setGenerating(true);
    setError('');
    try {
      await api(`/jobs/run?job=reorderSuggestions&tenantId=${tenantId}`, { method: 'POST' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível gerar sugestões de reposição.');
    }
    setGenerating(false);
  }

  // ─── Reconciliação ────────────────────────────────────────────────────────
  // As três versões de uma encomenda — o que se pediu, o que chegou, o que se pagou.
  // `computeOrderReconciliation` e `freezeOrderReconciliation` existiam com rota e sem
  // consumidor nenhum: a clínica recebia a encomenda e não tinha como saber se o que
  // veio era o que tinha pedido.
  //
  // Só aparece em encomendas recebidas, e carrega a pedido: comparar três fontes por
  // cada encomenda da lista seria pagar o custo para a esmagadora maioria que ninguém
  // vai abrir.
  // biome-ignore lint/suspicious/noExplicitAny: forma do relatório varia com o estado (congelado ou calculado)
  const [recon, setRecon] = useState<Record<string, any>>({});
  const [reconBusy, setReconBusy] = useState<string | null>(null);

  async function verReconciliacao(id: string) {
    if (recon[id]) {
      setRecon((r) => ({ ...r, [id]: undefined }));
      return;
    }
    setReconBusy(id);
    setError('');
    try {
      const r = await api(`/purchase-orders/${id}/reconcile`);
      setRecon((prev) => ({ ...prev, [id]: r }));
    } catch (e) {
      // Um `null` no mapa de reconciliação desenhava-se como «nada a apontar»,
      // que é a leitura oposta de «não consegui comparar».
      setError(e instanceof Error ? e.message : 'Não foi possível reconciliar esta encomenda.');
    }
    setReconBusy(null);
  }

  async function congelar(id: string) {
    setReconBusy(id);
    setError('');
    try {
      const r = await api(`/purchase-orders/${id}/reconcile`, { method: 'POST' });
      setRecon((prev) => ({ ...prev, [id]: r }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível congelar a reconciliação.');
    }
    setReconBusy(null);
  }

  async function setStatus(order: PurchaseOrder, status: 'ordered' | 'cancelled' | 'received') {
    setBusyId(order.id);
    setError('');
    try {
      await api(`/purchase-orders/${order.id}`, { method: 'PUT', body: { status } });
      load();
      if (status === 'received') onReceived?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível mudar o estado da encomenda.');
    }
    setBusyId(null);
  }

  function openCreate() {
    setLines([newLine(items[0]?.id ? String(items[0].id) : '')]);
    setError('');
    setCreateModal(true);
  }

  async function saveOrder() {
    const cleaned = lines.filter((l) => l.itemId && Number(l.quantity) > 0);
    if (!cleaned.length) {
      setError('Adicione pelo menos um item com quantidade válida.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api('/purchase-orders', {
        method: 'POST',
        body: {
          tenantId,
          items: cleaned.map((l) => ({ itemId: Number(l.itemId), quantity: Number(l.quantity) })),
        },
      });
      setCreateModal(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar encomenda.');
    } finally {
      setSaving(false);
    }
  }

  if (ordersQuery.error)
    return (
      <ErrorState
        error={ordersQuery.error}
        onRetry={ordersQuery.refetch}
        message="Não foi possível ler as encomendas."
      />
    );
  if (ordersQuery.loading) return <Spinner />;
  if (ordersQuery.error) return <ErrorState error={ordersQuery.error} onRetry={ordersQuery.refetch} />;
  if (!tenantId) return <Empty message="Escolha uma clínica." />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="section-label">ENCOMENDAS DE REPOSIÇÃO</div>
        <div className="flex items-center gap-2">
          <GhostBtn onClick={generateSuggestions} disabled={generating}>
            {generating ? 'A gerar…' : 'Gerar sugestões'}
          </GhostBtn>
          <PrimaryBtn onClick={openCreate}>+ Nova encomenda</PrimaryBtn>
        </div>
      </div>

      {!orders.length ? (
        <Empty message="Sem encomendas. Gere sugestões automáticas ou crie uma manualmente." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {orders.map((o) => {
            const meta = STATUS_META[o.status];
            return (
              <div key={o.id} className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge label={meta.label} bg={meta.bg} color={meta.color} />
                    <Badge
                      label={o.source === 'auto' ? 'Sugestão automática' : 'Manual'}
                      bg="var(--bg-sunken)"
                      color="var(--text-secondary)"
                    />
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(o.created_at).toLocaleDateString('pt-PT')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.status === 'draft' && (
                      <>
                        <GhostBtn
                          disabled={busyId === o.id}
                          onClick={() => setStatus(o, 'cancelled')}
                          style={{ padding: '5px 10px', fontSize: 12 }}
                        >
                          Cancelar
                        </GhostBtn>
                        <PrimaryBtn
                          disabled={busyId === o.id}
                          onClick={() => setStatus(o, 'ordered')}
                          style={{ padding: '5px 10px', fontSize: 12 }}
                        >
                          Marcar como encomendado
                        </PrimaryBtn>
                      </>
                    )}
                    {o.status === 'received' && (
                      <GhostBtn
                        disabled={reconBusy === o.id}
                        onClick={() => verReconciliacao(o.id)}
                        style={{ padding: '5px 10px', fontSize: 12 }}
                      >
                        {recon[o.id] ? 'Fechar reconciliação' : 'Reconciliar'}
                      </GhostBtn>
                    )}
                    {o.status === 'ordered' && (
                      <>
                        <GhostBtn
                          disabled={busyId === o.id}
                          onClick={() => setStatus(o, 'cancelled')}
                          style={{ padding: '5px 10px', fontSize: 12 }}
                        >
                          Cancelar
                        </GhostBtn>
                        <PrimaryBtn
                          disabled={busyId === o.id}
                          onClick={() => setStatus(o, 'received')}
                          style={{ padding: '5px 10px', fontSize: 12 }}
                        >
                          Marcar como recebido
                        </PrimaryBtn>
                      </>
                    )}
                  </div>
                </div>
                <div className="table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      {o.items.map((it) => (
                        <tr key={it.id}>
                          <TD>{it.item_name}</TD>
                          <TD muted>{it.unit}</TD>
                          <TD right>{it.quantity}</TD>
                          <TD muted>{it.expiry_date ? `val. ${it.expiry_date.slice(0, 10)}` : ''}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {recon[o.id] && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '11px 13px',
                      borderRadius: 'var(--radius-control)',
                      background: recon[o.id].clean ? 'var(--urgency-ok-bg)' : 'var(--urgency-soon-bg)',
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <b style={{ color: recon[o.id].clean ? 'var(--urgency-ok)' : 'var(--urgency-soon)' }}>
                        {recon[o.id].clean ? 'Bate certo' : `${recon[o.id].discrepancies?.length || 0} discrepância(s)`}
                        {recon[o.id].frozen ? ' · congelada' : ''}
                      </b>
                      <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        pedido {formatEUR(recon[o.id].orderedValue || 0)} · recebido{' '}
                        {formatEUR(recon[o.id].receivedValue || 0)}
                      </span>
                    </div>
                    {(recon[o.id].discrepancies || []).map(
                      // biome-ignore lint/suspicious/noExplicitAny: linha do relatório, tipada em lib/inventoryCalc.ts
                      (d: any) => (
                        <div key={`${d.itemId}-${d.kind}`} style={{ marginTop: 5, color: 'var(--text-secondary)' }}>
                          <b>{d.item}</b> — {d.detail}
                          {d.valueDelta !== null ? ` (${formatEUR(d.valueDelta)})` : ''}
                        </div>
                      ),
                    )}
                    {!recon[o.id].frozen && (
                      <div style={{ marginTop: 9 }}>
                        <GhostBtn
                          disabled={reconBusy === o.id}
                          onClick={() => congelar(o.id)}
                          style={{ padding: '4px 10px', fontSize: 12 }}
                        >
                          Congelar reconciliação
                        </GhostBtn>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {createModal && (
        <Modal title="Nova encomenda" onClose={() => setCreateModal(false)} width={560}>
          {lines.map((line, i) => (
            <div
              key={line.key}
              style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 10, marginBottom: 10 }}
            >
              <FormField label={i === 0 ? 'Item' : ''}>
                <Sel
                  value={line.itemId}
                  onChange={(e) =>
                    setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, itemId: e.target.value } : l)))
                  }
                >
                  <option value="">Selecionar…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.item}
                    </option>
                  ))}
                </Sel>
              </FormField>
              <FormField label={i === 0 ? 'Quantidade' : ''}>
                <input
                  type="number"
                  min={1}
                  className="input"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((ls) => ls.map((l) => (l.key === line.key ? { ...l, quantity: e.target.value } : l)))
                  }
                />
              </FormField>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                <GhostBtn
                  onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  disabled={lines.length === 1}
                  style={{ padding: '8px 10px' }}
                >
                  ×
                </GhostBtn>
              </div>
            </div>
          ))}
          <GhostBtn onClick={() => setLines((ls) => [...ls, newLine()])} style={{ marginBottom: 14 }}>
            + Adicionar item
          </GhostBtn>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--urgency-critical)', fontWeight: 700, marginBottom: 10 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setCreateModal(false)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={saveOrder} disabled={saving}>
              {saving ? 'A criar…' : 'Criar encomenda'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
