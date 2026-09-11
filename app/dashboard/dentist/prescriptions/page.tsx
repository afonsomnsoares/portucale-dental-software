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
  Textarea,
} from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { Patient, Prescription } from '@/lib/types';

interface NewPrescriptionForm {
  medication: string;
  dosage: string;
  frequency: string;
  route: string;
  duration: string;
  quantity: string;
  refills: number | string;
  instructions: string;
}

export default function PrescriptionsPage() {
  const { api } = useAuth();
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  // Guardar falhava em silêncio: o modal fechava-se na mesma e a linha nova
  // não aparecia. Quem escreveu não sabia se tinha ficado gravado.
  const [erroEscrita, setErroEscrita] = useState('');
  const [form, setForm] = useState<NewPrescriptionForm>({
    medication: '',
    dosage: '',
    frequency: '',
    route: 'oral',
    duration: '',
    quantity: '',
    refills: 0,
    instructions: '',
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
  const prescriptionsQuery = useQuery<Prescription[]>(pid ? `/prescriptions?patientId=${pid}` : null);
  const prescriptions = prescriptionsQuery.data ?? [];

  async function create() {
    if (!form.medication || !form.dosage || !form.frequency || !selected) return;
    setSaving(true);
    setErroEscrita('');
    try {
      await api('/prescriptions', {
        method: 'POST',
        body: { patientId: selected.id, ...form, refills: Number(form.refills) },
      });
      prescriptionsQuery.refetch();
      setModal(false);
      setForm({
        medication: '',
        dosage: '',
        frequency: '',
        route: 'oral',
        duration: '',
        quantity: '',
        refills: 0,
        instructions: '',
      });
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível emitir a receita.');
    }
    setSaving(false);
  }

  async function cancel(id: string) {
    setErroEscrita('');
    try {
      await api(`/prescriptions/${id}`, { method: 'PUT', body: { status: 'cancelled' } });
      prescriptionsQuery.refetch();
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    }
  }

  const cols = ['Medicamento', 'Dosagem', 'Frequência', 'Estado', 'Data', 'Ações'];

  return (
    <div>
      <PageHeader title="Prescrições" sub="Prescrições do doente — emitir e acompanhar" />
      {erroEscrita ? <AlertBanner type="danger">{erroEscrita}</AlertBanner> : null}
      {prescriptionsQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler as prescrições deste doente. {prescriptionsQuery.error.message}
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
              <PrimaryBtn onClick={() => setModal(true)}>+ Nova Prescrição</PrimaryBtn>
            </div>
            {!prescriptions.length ? (
              <Empty message="Sem prescrições" />
            ) : (
              <div className="card" style={{ padding: 0 }}>
                <DataTable
                  cols={cols}
                  rows={prescriptions.map((p) => (
                    <tr key={p.id}>
                      <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                        {p.medication}
                      </td>
                      <td className="data-td">{p.dosage}</td>
                      <td className="data-td">{p.frequency}</td>
                      <td className="data-td">
                        <Badge s={p.status} />
                      </td>
                      <td className="data-td">{p.created_at?.slice(0, 10)}</td>
                      <td className="data-td">
                        {p.status !== 'cancelled' && (
                          <DangerBtn
                            style={{ padding: '4px 12px', fontSize: 'var(--text-2xs)' }}
                            onClick={() => cancel(p.id)}
                          >
                            Anular
                          </DangerBtn>
                        )}
                      </td>
                    </tr>
                  ))}
                />
              </div>
            )}
          </div>
        ) : (
          <Empty message="Selecione um doente para ver as prescrições" />
        )}
      </div>

      {modal && (
        <Modal title="Nova Prescrição" onClose={() => setModal(false)} width={540}>
          <FormField label="Medicamento *">
            <Inp
              value={form.medication}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, medication: e.target.value }))}
              placeholder="Nome do medicamento"
            />
          </FormField>
          <div className="grid-pair" style={{ gap: 12 }}>
            <FormField label="Dosagem *">
              <Inp
                value={form.dosage}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, dosage: e.target.value }))}
                placeholder="ex: 500 mg"
              />
            </FormField>
            <FormField label="Frequência *">
              <Inp
                value={form.frequency}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, frequency: e.target.value }))}
                placeholder="ex: 2x por dia"
              />
            </FormField>
          </div>
          <div className="grid-pair" style={{ gap: 12 }}>
            <FormField label="Via">
              <Sel value={form.route} onChange={(e) => setForm((p) => ({ ...p, route: e.target.value }))}>
                <option value="oral">Oral</option>
                <option value="topical">Tópica</option>
                <option value="IV">IV</option>
                <option value="IM">IM</option>
              </Sel>
            </FormField>
            <FormField label="Duração">
              <Inp
                value={form.duration}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, duration: e.target.value }))}
                placeholder="ex: 7 dias"
              />
            </FormField>
          </div>
          <div className="grid-pair" style={{ gap: 12 }}>
            <FormField label="Quantidade">
              <Inp
                type="number"
                value={form.quantity}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, quantity: e.target.value }))}
              />
            </FormField>
            <FormField label="Renovações">
              <Inp
                type="number"
                min={0}
                value={form.refills}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, refills: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Instruções">
            <Textarea
              value={form.instructions}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                setForm((p) => ({ ...p, instructions: e.target.value }))
              }
              placeholder="Posologia e instruções de utilização…"
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={create} disabled={saving || !form.medication || !form.dosage || !form.frequency}>
              {saving ? 'A emitir…' : 'Emitir Prescrição'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
