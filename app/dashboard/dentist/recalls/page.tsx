'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  AlertBanner,
  Badge,
  DangerBtn,
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
} from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { Patient, Recall } from '@/lib/types';

const RECALL_TYPES = ['checkup', 'prophylaxis', 'follow-up', 'other'];
const RECALL_TYPE_LABELS: Record<string, string> = {
  checkup: 'Consulta de controlo',
  prophylaxis: 'Higiene oral',
  'follow-up': 'Seguimento',
  other: 'Outro',
};

interface NewRecallForm {
  recallType: string;
  intervalMonths: number | string;
  nextDue: string;
}

export default function RecallsPage() {
  const { api } = useAuth();
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  // Guardar falhava em silêncio: o modal fechava-se na mesma e a linha nova
  // não aparecia. Quem escreveu não sabia se tinha ficado gravado.
  const [erroEscrita, setErroEscrita] = useState('');
  const [form, setForm] = useState<NewRecallForm>({ recallType: 'checkup', intervalMonths: 6, nextDue: '' });

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
  const recallsQuery = useQuery<Recall[]>(pid ? `/recalls?patientId=${pid}` : null);
  const recalls = recallsQuery.data ?? [];

  async function create() {
    if (!form.nextDue || !selected) return;
    setSaving(true);
    setErroEscrita('');
    try {
      await api('/recalls', {
        method: 'POST',
        body: { patientId: selected.id, ...form, intervalMonths: Number(form.intervalMonths) },
      });
      recallsQuery.refetch();
      setModal(false);
      setForm({ recallType: 'checkup', intervalMonths: 6, nextDue: '' });
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível criar o recall.');
    }
    setSaving(false);
  }

  async function complete(id: string) {
    setErroEscrita('');
    try {
      await api(`/recalls/${id}`, { method: 'PUT', body: { complete: true } });
      recallsQuery.refetch();
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    }
  }

  async function deactivate(id: string) {
    setErroEscrita('');
    try {
      await api(`/recalls/${id}`, { method: 'PUT', body: { active: false } });
      recallsQuery.refetch();
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    }
  }

  function recallStatus(r: Recall) {
    if (!r.active) return { label: 'Inativo', bg: 'var(--bg-page)', color: 'var(--text-muted)' };
    const due = r.next_due ? new Date(r.next_due) : null;
    if (due && due < new Date())
      return { label: 'Em atraso', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' };
    return { label: 'Ativo', bg: 'var(--accent-bg)', color: 'var(--accent)' };
  }

  const cols = ['Tipo', 'Intervalo', 'Última vez', 'Próximo', 'Estado', 'Lembrete enviado', 'Ações'];

  return (
    <div>
      <PageHeader title="Recalls" sub="Chamadas de retorno do doente, com lembrete automático" />
      {erroEscrita ? <AlertBanner type="danger">{erroEscrita}</AlertBanner> : null}
      {recallsQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler os recalls deste doente. {recallsQuery.error.message}
        </AlertBanner>
      ) : null}
      <div className="grid-sidebar" style={{ gap: 16 }}>
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
                  <div
                    style={{
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--weight-semibold)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {p.name}
                  </div>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
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
              <PrimaryBtn onClick={() => setModal(true)}>+ Novo Recall</PrimaryBtn>
            </div>
            {!recalls.length ? (
              <Empty message="Sem recalls definidos" />
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <DataTable
                  cols={cols}
                  rows={recalls.map((r) => {
                    const s = recallStatus(r);
                    return (
                      <tr key={r.id}>
                        <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                          {RECALL_TYPE_LABELS[r.recall_type] || r.recall_type}
                        </td>
                        <td className="data-td">{r.interval_months} meses</td>
                        <td className="data-td">{r.last_done ? r.last_done.slice(0, 10) : '—'}</td>
                        <td className="data-td">{r.next_due ? r.next_due.slice(0, 10) : '—'}</td>
                        <td className="data-td">
                          <Badge label={s.label} bg={s.bg} color={s.color} />
                        </td>
                        <td className="data-td" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                          {r.last_notified_at ? r.last_notified_at.slice(0, 10) : '—'}
                        </td>
                        <td className="data-td">
                          {r.active && (
                            <>
                              <GhostBtn
                                style={{ padding: '4px 12px', fontSize: 'var(--text-2xs)', marginRight: 4 }}
                                onClick={() => complete(r.id)}
                              >
                                Marcar feito
                              </GhostBtn>
                              <DangerBtn
                                style={{ padding: '4px 12px', fontSize: 'var(--text-2xs)' }}
                                onClick={() => deactivate(r.id)}
                              >
                                Desativar
                              </DangerBtn>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                />
              </div>
            )}
          </div>
        ) : (
          <Empty message="Selecione um doente para ver os recalls" />
        )}
      </div>

      {modal && (
        <Modal title="Novo Recall" onClose={() => setModal(false)} width={460}>
          <FormField label="Tipo de recall">
            <Sel value={form.recallType} onChange={(e) => setForm((p) => ({ ...p, recallType: e.target.value }))}>
              {RECALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RECALL_TYPE_LABELS[t] || t}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Intervalo (meses)">
            <Inp
              type="number"
              min={1}
              max={60}
              value={form.intervalMonths}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setForm((p) => ({ ...p, intervalMonths: e.target.value }))
              }
            />
          </FormField>
          <FormField label="Próxima data *">
            <Inp
              type="date"
              value={form.nextDue}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, nextDue: e.target.value }))}
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.nextDue}>
              {saving ? 'A criar…' : 'Criar Recall'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
