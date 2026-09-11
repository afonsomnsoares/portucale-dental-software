'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  AlertBanner,
  Badge,
  DataTable,
  Empty,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
  Textarea,
} from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { formatEUR } from '@/lib/constants';
import type { LabOrder, Patient } from '@/lib/types';

const CASE_TYPES = ['crown', 'bridge', 'denture', 'implant', 'veneer', 'ortho', 'other'];
const CASE_TYPE_LABELS: Record<string, string> = {
  crown: 'Coroa',
  bridge: 'Ponte',
  denture: 'Prótese removível',
  implant: 'Implante',
  veneer: 'Faceta',
  ortho: 'Ortodontia',
  other: 'Outro',
};

const STATUS_FLOW = ['ordered', 'sent', 'in-progress', 'received'];
const STATUS_LABELS: Record<string, string> = {
  ordered: 'Por enviar',
  sent: 'Enviado',
  'in-progress': 'Em execução',
  received: 'Recebido',
};
const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  ordered: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  sent: { bg: 'var(--accent-bg)', color: 'var(--accent)' },
  'in-progress': { bg: 'var(--cat-purple-bg)', color: 'var(--cat-purple)' },
  received: { bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
};

interface NewLabOrderForm {
  labName: string;
  caseType: string;
  description: string;
  instructions: string;
  dueDate: string;
  fee: string;
}

export default function LabOrdersPage() {
  const { api } = useAuth();
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  // Guardar falhava em silêncio: o modal fechava-se na mesma e a linha nova
  // não aparecia. Quem escreveu não sabia se tinha ficado gravado.
  const [erroEscrita, setErroEscrita] = useState('');
  const [form, setForm] = useState<NewLabOrderForm>({
    labName: '',
    caseType: 'crown',
    description: '',
    instructions: '',
    dueDate: '',
    fee: '',
  });

  const select = useCallback((p: Patient) => {
    setSelected(p);
  }, []);

  const patientsQuery = useQuery<Patient[]>('/patients');
  const patients = patientsQuery.data ?? [];

  // O primeiro doente abre sozinho, e só enquanto ninguém tiver escolhido.
  useEffect(() => {
    if (!selected && patients.length) select(patients[0]);
  }, [selected, patients, select]);

  // `null` enquanto não houver doente escolhido: o hook espera em vez de
  // pedir um caminho com `undefined` lá dentro.
  const pid = selected?.id ?? null;
  const ordersQuery = useQuery<LabOrder[]>(pid ? `/lab-orders?patientId=${pid}` : null);
  const orders = ordersQuery.data ?? [];

  async function create() {
    if (!form.labName || !form.description || !selected) return;
    setSaving(true);
    setErroEscrita('');
    try {
      await api('/lab-orders', {
        method: 'POST',
        body: { patientId: selected.id, ...form, fee: Number(form.fee) || 0 },
      });
      ordersQuery.refetch();
      setModal(false);
      setForm({
        labName: '',
        caseType: 'crown',
        description: '',
        instructions: '',
        dueDate: '',
        fee: '',
      });
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível criar o pedido ao laboratório.');
    }
    setSaving(false);
  }

  async function advanceStatus(order: LabOrder) {
    const idx = STATUS_FLOW.indexOf(order.status);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];
    setErroEscrita('');
    try {
      await api(`/lab-orders/${order.id}`, { method: 'PUT', body: { status: next } });
      ordersQuery.refetch();
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    }
  }

  function renderStatusBadge(s: string) {
    const cfg = STATUS_COLORS[s] || { bg: 'var(--bg-page)', color: 'var(--text-secondary)' };
    return <Badge label={STATUS_LABELS[s] || s} bg={cfg.bg} color={cfg.color} />;
  }

  const cols = ['Laboratório', 'Tipo de trabalho', 'Estado', 'Prazo', 'Valor', 'Ações'];

  return (
    <div>
      <PageHeader title="Encomendas de Laboratório" sub="Trabalhos protéticos, do envio à receção" />
      {erroEscrita ? <AlertBanner type="danger">{erroEscrita}</AlertBanner> : null}
      {ordersQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler as encomendas deste doente. {ordersQuery.error.message}
        </AlertBanner>
      ) : null}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--bg-sunken)' }}>
            <input
              className="input"
              placeholder="Procurar por nome ou nº…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div style={{ maxHeight: 'calc(100vh - 240px)', overflowY: 'auto' }}>
            {patientsQuery.loading ? (
              <Spinner />
            ) : !patients.length ? (
              <Empty message="Sem doentes" />
            ) : (
              patients.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => select(p)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      select(p);
                    }
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    border: 'none',
                    font: 'inherit',
                    textAlign: 'left',
                    padding: '11px 16px',
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--bg-page)',
                    background: selected?.id === p.id ? 'var(--accent-bg)' : 'white',
                    borderLeft: `3px solid ${selected?.id === p.id ? 'var(--accent)' : 'transparent'}`,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    #{p.global_seq} · <Badge s={p.status} />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {selected ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
              <PrimaryBtn onClick={() => setModal(true)}>+ Nova Encomenda</PrimaryBtn>
            </div>
            {!orders.length ? (
              <Empty message="Sem encomendas de laboratório" />
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <DataTable
                  cols={cols}
                  rows={orders.map((o) => (
                    <tr key={o.id}>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {o.lab_name}
                      </td>
                      <td className="data-td">{CASE_TYPE_LABELS[o.case_type] || o.case_type}</td>
                      <td className="data-td">{renderStatusBadge(o.status)}</td>
                      <td className="data-td">{o.due_date ? o.due_date.slice(0, 10) : '—'}</td>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {formatEUR(Number(o.fee || 0))}
                      </td>
                      <td className="data-td">
                        {o.status !== 'received' && (
                          <GhostBtn style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => advanceStatus(o)}>
                            {o.status === 'ordered'
                              ? 'Marcar enviado'
                              : o.status === 'sent'
                                ? 'Em execução'
                                : 'Marcar recebido'}
                          </GhostBtn>
                        )}
                      </td>
                    </tr>
                  ))}
                />
              </div>
            )}
          </div>
        ) : (
          <Empty message="Selecione um doente para ver as encomendas" />
        )}
      </div>

      {modal && (
        <Modal title="Nova Encomenda de Laboratório" onClose={() => setModal(false)} width={540}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Laboratório *">
              <Inp
                value={form.labName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, labName: e.target.value }))}
                placeholder="Nome do laboratório"
              />
            </FormField>
            <FormField label="Tipo de trabalho">
              <Sel value={form.caseType} onChange={(e) => setForm((p) => ({ ...p, caseType: e.target.value }))}>
                {CASE_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {CASE_TYPE_LABELS[c] || c}
                  </option>
                ))}
              </Sel>
            </FormField>
          </div>
          <FormField label="Descrição *">
            <Textarea
              value={form.description}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              placeholder="O que se pede ao laboratório…"
            />
          </FormField>
          <FormField label="Instruções">
            <Textarea
              value={form.instructions}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, instructions: e.target.value }))
              }
              placeholder="Cor, material, notas de execução…"
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Prazo de entrega">
              <Inp
                type="date"
                value={form.dueDate}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, dueDate: e.target.value }))}
              />
            </FormField>
            <FormField label="Valor (€)">
              <Inp
                type="number"
                value={form.fee}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, fee: e.target.value }))}
              />
            </FormField>
          </div>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.labName || !form.description}>
              {saving ? 'A criar…' : 'Criar Encomenda'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
