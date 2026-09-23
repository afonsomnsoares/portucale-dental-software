'use client';
import { type ChangeEvent, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  AlertBanner,
  Badge,
  ConfirmModal,
  DangerBtn,
  DataTable,
  Empty,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PrimaryBtn,
  Sel,
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

export default function PatientRecallsTab({ patient }: { patient: Patient }) {
  const { api } = useAuth();
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  // Guardar falhava em silêncio: o modal fechava-se na mesma e a linha nova
  // não aparecia. Quem escreveu não sabia se tinha ficado gravado.
  const [erroEscrita, setErroEscrita] = useState('');
  const [aDesativar, setADesativar] = useState<Recall | null>(null);
  const [desativando, setDesativando] = useState(false);
  const [form, setForm] = useState<NewRecallForm>({ recallType: 'checkup', intervalMonths: 6, nextDue: '' });

  const pid = patient.id;
  const recallsQuery = useQuery<Recall[]>(`/recalls?patientId=${pid}`);
  const recalls = recallsQuery.data ?? [];

  async function create() {
    if (!form.nextDue || !patient) return;
    setSaving(true);
    setErroEscrita('');
    try {
      await api('/recalls', {
        method: 'POST',
        body: { patientId: patient.id, ...form, intervalMonths: Number(form.intervalMonths) },
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
    if (desativando) return;
    setErroEscrita('');
    setDesativando(true);
    try {
      await api(`/recalls/${id}`, { method: 'PUT', body: { active: false } });
      setADesativar(null);
      recallsQuery.refetch();
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    } finally {
      setDesativando(false);
    }
  }

  function recallStatus(r: Recall) {
    if (!r.active) return { label: 'Inativo', bg: 'var(--bg-sunken)', color: 'var(--text-muted)' };
    const due = r.next_due ? new Date(r.next_due) : null;
    if (due && due < new Date())
      return { label: 'Em atraso', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' };
    return { label: 'Ativo', bg: 'var(--accent-bg)', color: 'var(--accent)' };
  }

  const cols = ['Tipo', 'Intervalo', 'Última vez', 'Próximo', 'Estado', 'Lembrete enviado', 'Ações'];

  return (
    <div>
      {erroEscrita ? <AlertBanner type="danger">{erroEscrita}</AlertBanner> : null}
      {recallsQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler os recalls deste doente. {recallsQuery.error.message}
        </AlertBanner>
      ) : null}

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
                            onClick={() => setADesativar(r)}
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

      {aDesativar && (
        <ConfirmModal
          title="Desativar recall"
          confirmLabel="Desativar"
          busyLabel="A desativar…"
          emCurso={desativando}
          onConfirm={() => deactivate(aDesativar.id)}
          onCancel={() => setADesativar(null)}
        >
          <strong style={{ color: 'var(--text-primary)' }}>{aDesativar.patient_name || 'Este doente'}</strong>
          <br />O doente deixa de ser convocado por este recall. O histórico fica.
        </ConfirmModal>
      )}
    </div>
  );
}
