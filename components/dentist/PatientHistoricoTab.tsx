'use client';
import { type ChangeEvent, type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { AlertBanner, DangerBtn, FormField, GhostBtn, Inp, PrimaryBtn, Sel, Textarea } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { Patient } from '@/lib/types';

interface HistoryItem {
  name: string;
  notes: string;
}

type HistoryListKey = 'allergies' | 'medications' | 'conditions';

interface MedicalHistoryForm {
  allergies: HistoryItem[];
  medications: HistoryItem[];
  conditions: HistoryItem[];
  family_history: string;
  smoking: string;
  pregnancy: string;
  notes: string;
}

export default function PatientHistoricoTab({ patient }: { patient: Patient }) {
  const { api } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<MedicalHistoryForm>({
    allergies: [],
    medications: [],
    conditions: [],
    family_history: '',
    smoking: 'never',
    pregnancy: 'no',
    notes: '',
  });
  const [newAllergy, setNewAllergy] = useState<HistoryItem>({ name: '', notes: '' });
  const [newMed, setNewMed] = useState<HistoryItem>({ name: '', notes: '' });
  const [newCond, setNewCond] = useState<HistoryItem>({ name: '', notes: '' });

  // A anamnese do doente escolhido. Falhar aqui é o caso grave desta página: o
  // `.catch(() => null)` anterior enchia o formulário de valores por omissão —
  // «sem alergias», «nunca fumou» — e o dentista lia isso como o histórico do
  // doente. Um histórico clínico que não carregou tem de dizê-lo.
  const pid = patient.id;
  const historyQuery = useQuery<MedicalHistoryForm>(`/patients/${pid}/medical-history`);

  // biome-ignore lint/correctness/useExhaustiveDependencies: o formulário repõe-se quando o doente ou a resposta mudam
  useEffect(() => {
    const mh = historyQuery.data;
    setForm({
      allergies: mh?.allergies || [],
      medications: mh?.medications || [],
      conditions: mh?.conditions || [],
      family_history: mh?.family_history || '',
      smoking: mh?.smoking || 'never',
      pregnancy: mh?.pregnancy || 'no',
      notes: mh?.notes || '',
    });
  }, [historyQuery.data, pid]);

  function addListItem(
    list: HistoryListKey,
    _setList: unknown,
    item: HistoryItem,
    setItem: Dispatch<SetStateAction<HistoryItem>>,
  ) {
    if (!item.name) return;
    setForm((prev) => ({ ...prev, [list]: [...(prev[list] || []), item] }));
    setItem({ name: '', notes: '' });
  }

  function removeListItem(list: HistoryListKey, idx: number) {
    setForm((prev) => ({ ...prev, [list]: prev[list].filter((_, i) => i !== idx) }));
  }

  function renderListEditor(
    label: string,
    listKey: HistoryListKey,
    item: HistoryItem,
    setItem: Dispatch<SetStateAction<HistoryItem>>,
    placeholder?: string,
  ) {
    return (
      <div
        className="card"
        style={{ padding: '12px 16px', border: '1px solid var(--border-subtle)', marginBottom: 12 }}
      >
        <div className="section-label mb-2">{label}</div>
        {(form[listKey] || []).map((it, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: allergy/medication/condition entries have no id; index matches removeListItem's own indexing
            key={i}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--text-primary)',
                }}
              >
                {it.name}
              </span>
              {it.notes && (
                <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginLeft: 8 }}>
                  — {it.notes}
                </span>
              )}
            </div>
            <DangerBtn
              style={{ padding: '2px 8px', fontSize: 'var(--text-2xs)' }}
              onClick={() => removeListItem(listKey, i)}
            >
              Retirar
            </DangerBtn>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Inp
            placeholder={placeholder || 'Designação'}
            value={item.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setItem((p) => ({ ...p, name: e.target.value }))}
            style={{ flex: 1 }}
          />
          <Inp
            placeholder="Notas"
            value={item.notes}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setItem((p) => ({ ...p, notes: e.target.value }))}
            style={{ flex: 1 }}
          />
          <GhostBtn onClick={() => addListItem(listKey, setForm, item, setItem)}>+ Add</GhostBtn>
        </div>
      </div>
    );
  }

  async function handleSave() {
    if (!patient) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/patients/${patient.id}/medical-history`, { method: 'PUT', body: form });
      historyQuery.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível guardar o histórico clínico.');
    }
    setSaving(false);
  }

  return (
    <div>
      {historyQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler o histórico deste doente — o que está em baixo não é a anamnese dele.{' '}
          {historyQuery.error.message}
        </AlertBanner>
      ) : null}
      <div>
        {error && <AlertBanner type="danger">{error}</AlertBanner>}
        {renderListEditor('Alergias', 'allergies', newAllergy, setNewAllergy, 'Alergénio')}
        {renderListEditor('Medicação', 'medications', newMed, setNewMed, 'Medicamento')}
        {renderListEditor('Condições', 'conditions', newCond, setNewCond, 'Condição')}
        <div className="grid-pair" style={{ gap: 12 }}>
          <FormField label="Tabagismo">
            <Sel value={form.smoking} onChange={(e) => setForm((p) => ({ ...p, smoking: e.target.value }))}>
              <option value="never">Nunca fumou</option>
              <option value="former">Ex-fumador</option>
              <option value="current">Fumador</option>
            </Sel>
          </FormField>
          <FormField label="Gravidez">
            <Sel value={form.pregnancy} onChange={(e) => setForm((p) => ({ ...p, pregnancy: e.target.value }))}>
              <option value="no">Não</option>
              <option value="yes">Sim</option>
              <option value="not-applicable">Não aplicável</option>
            </Sel>
          </FormField>
        </div>
        <FormField label="História Familiar">
          <Textarea
            value={form.family_history}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              setForm((p) => ({ ...p, family_history: e.target.value }))
            }
            placeholder="Antecedentes familiares relevantes…"
          />
        </FormField>
        <FormField label="Notas">
          <Textarea
            value={form.notes}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Outras notas clínicas…"
          />
        </FormField>
        <div className="flex gap-3 mt-2">
          <PrimaryBtn onClick={handleSave} disabled={saving}>
            {saving ? 'A guardar…' : 'Guardar Histórico'}
          </PrimaryBtn>
        </div>
      </div>{' '}
    </div>
  );
}
