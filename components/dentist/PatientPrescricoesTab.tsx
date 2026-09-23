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

export default function PatientPrescricoesTab({ patient }: { patient: Patient }) {
  const { api } = useAuth();
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  // Guardar falhava em silêncio: o modal fechava-se na mesma e a linha nova
  // não aparecia. Quem escreveu não sabia se tinha ficado gravado.
  const [erroEscrita, setErroEscrita] = useState('');
  // Anular uma prescrição é mexer num registo clínico, e era um clique só.
  const [aAnular, setAAnular] = useState<Prescription | null>(null);
  const [anulando, setAnulando] = useState(false);
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

  const pid = patient.id;
  const prescriptionsQuery = useQuery<Prescription[]>(`/prescriptions?patientId=${pid}`);
  const prescriptions = prescriptionsQuery.data ?? [];

  async function create() {
    if (!form.medication || !form.dosage || !form.frequency || !patient) return;
    setSaving(true);
    setErroEscrita('');
    try {
      await api('/prescriptions', {
        method: 'POST',
        body: { patientId: patient.id, ...form, refills: Number(form.refills) },
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
    if (anulando) return;
    setErroEscrita('');
    setAnulando(true);
    try {
      await api(`/prescriptions/${id}`, { method: 'PUT', body: { status: 'cancelled' } });
      setAAnular(null);
      prescriptionsQuery.refetch();
    } catch (e) {
      setErroEscrita(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    } finally {
      setAnulando(false);
    }
  }

  const cols = ['Medicamento', 'Dosagem', 'Frequência', 'Estado', 'Data', 'Ações'];

  return (
    <div>
      {erroEscrita ? <AlertBanner type="danger">{erroEscrita}</AlertBanner> : null}
      {prescriptionsQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler as prescrições deste doente. {prescriptionsQuery.error.message}
        </AlertBanner>
      ) : null}

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
                        onClick={() => setAAnular(p)}
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

      {aAnular && (
        <ConfirmModal
          title="Anular prescrição"
          confirmLabel="Anular prescrição"
          busyLabel="A anular…"
          emCurso={anulando}
          onConfirm={() => cancel(aAnular.id)}
          onCancel={() => setAAnular(null)}
        >
          <strong style={{ color: 'var(--text-primary)' }}>
            {aAnular.medication} · {aAnular.dosage}
          </strong>
          <br />
          Fica marcada como anulada no registo do doente. O histórico não é apagado — a prescrição continua visível, com
          o estado «anulada».
        </ConfirmModal>
      )}
    </div>
  );
}
