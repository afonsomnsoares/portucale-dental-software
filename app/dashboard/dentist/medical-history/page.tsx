'use client';
import { type ChangeEvent, type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  AlertBanner,
  Badge,
  DangerBtn,
  Empty,
  FormField,
  GhostBtn,
  Inp,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
  Textarea,
} from '@/components/ui';
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

export default function MedicalHistoryPage() {
  const { api } = useAuth();
  const patientsQuery = useQuery<Patient[]>('/patients');
  const patients = patientsQuery.data ?? [];
  const [selected, setSelected] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
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

  const select = useCallback((p: Patient) => {
    setSelected(p);
    setError(null);
  }, []);

  useEffect(() => {
    if (!selected && patients.length) select(patients[0]);
  }, [selected, patients, select]);

  // A anamnese do doente escolhido. Falhar aqui é o caso grave desta página: o
  // `.catch(() => null)` anterior enchia o formulário de valores por omissão —
  // «sem alergias», «nunca fumou» — e o dentista lia isso como o histórico do
  // doente. Um histórico clínico que não carregou tem de dizê-lo.
  const pid = selected?.id ?? null;
  const historyQuery = useQuery<MedicalHistoryForm>(pid ? `/patients/${pid}/medical-history` : null);

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
              padding: '6px 0',
              borderBottom: '1px solid var(--bg-page)',
            }}
          >
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{it.name}</span>
              {it.notes && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>— {it.notes}</span>
              )}
            </div>
            <DangerBtn style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => removeListItem(listKey, i)}>
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
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/patients/${selected.id}/medical-history`, { method: 'PUT', body: form });
      historyQuery.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível guardar o histórico clínico.');
    }
    setSaving(false);
  }

  return (
    <div>
      <PageHeader title="Histórico Clínico" sub="Anamnese do doente — alergias, medicação e condições" />
      {historyQuery.error ? (
        <AlertBanner type="danger">
          Não foi possível ler o histórico deste doente — o que está em baixo não é a anamnese dele.{' '}
          {historyQuery.error.message}
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
            {error && <AlertBanner type="danger">{error}</AlertBanner>}
            {renderListEditor('Alergias', 'allergies', newAllergy, setNewAllergy, 'Alergénio')}
            {renderListEditor('Medicação', 'medications', newMed, setNewMed, 'Medicamento')}
            {renderListEditor('Condições', 'conditions', newCond, setNewCond, 'Condição')}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
          </div>
        ) : (
          <Empty message="Selecione um doente para ver o histórico clínico" />
        )}
      </div>
    </div>
  );
}
