'use client';
import { type ChangeEvent, useState } from 'react';
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
  PrimaryBtn,
  Sel,
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

export default function PatientLabOrdersTab({ patient }: { patient: Patient }) {
  const { api } = useAuth();
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

  const pid = patient.id;
  const ordersQuery = useQuery<LabOrder[]>(`/lab-orders?patientId=${pid}`);
  const orders = ordersQuery.data ?? [];

  async function create() {
    if (!form.labName || !form.description || !patient) return;
    setSaving(true);
    setErroEscrita('');
    try {
      await api('/lab-orders', {
        method: 'POST',
        body: { patientId: patient.id, ...form, fee: Number(form.fee) || 0 },
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
    const cfg = STATUS_COLORS[s] || { bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' };
    return <Badge label={STATUS_LABELS[s] || s} bg={cfg.bg} color={cfg.color} />;
  }

  const cols = ['Laboratório', 'Tipo de trabalho', 'Estado', 'Prazo', 'Valor', 'Ações'];

  return (
    <div>
      {erroEscrita ? <AlertBanner type="danger">{erroEscrita}</AlertBanner> : null}
      {ordersQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler as encomendas deste doente. {ordersQuery.error.message}
        </AlertBanner>
      ) : null}

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
                  <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                    {o.lab_name}
                  </td>
                  <td className="data-td">{CASE_TYPE_LABELS[o.case_type] || o.case_type}</td>
                  <td className="data-td">{renderStatusBadge(o.status)}</td>
                  <td className="data-td">{o.due_date ? o.due_date.slice(0, 10) : '—'}</td>
                  <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                    {formatEUR(Number(o.fee || 0))}
                  </td>
                  <td className="data-td">
                    {o.status !== 'received' && (
                      <GhostBtn
                        style={{ padding: '4px 12px', fontSize: 'var(--text-2xs)' }}
                        onClick={() => advanceStatus(o)}
                      >
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
      {modal && (
        <Modal title="Nova Encomenda de Laboratório" onClose={() => setModal(false)} width={540}>
          <div className="grid-pair" style={{ gap: 12 }}>
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
          <div className="grid-pair" style={{ gap: 12 }}>
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
