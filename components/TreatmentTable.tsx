'use client';
import { type ChangeEvent, useState } from 'react';
import { useAuth } from '@/app/providers';
import type { Treatment } from '@/lib/types';
import { Badge, FormField, GhostBtn, Inp, Modal, PrimaryBtn, Sel } from './ui';

interface TreatmentEditForm {
  treatmentCode: string;
  description: string;
  phase: number;
  status: string;
  fee: number | string;
  notes: string;
}

interface TreatmentTableProps {
  treatments?: Treatment[];
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
  showPatient?: boolean;
}

export default function TreatmentTable({
  treatments = [],
  onUpdate,
  onDelete,
  showPatient = false,
}: TreatmentTableProps) {
  const { settings } = useAuth();
  const TANOMD_CODES = settings?.TANOMD_CODES || [];

  const [editing, setEditing] = useState<Treatment | null>(null);
  const [form, setForm] = useState<TreatmentEditForm>({
    treatmentCode: '',
    description: '',
    phase: 1,
    status: 'proposto',
    fee: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  function openEdit(t: Treatment) {
    setForm({
      treatmentCode: t.treatment_code || '',
      description: t.description || '',
      phase: t.phase || 1,
      status: t.status || 'proposto',
      fee: t.fee || '',
      notes: t.notes || '',
    });
    setEditing(t);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    await onUpdate(editing.id, { ...form, fee: Number(form.fee), phase: Number(form.phase) });
    setSaving(false);
    setEditing(null);
  }

  async function handleDelete(id: string) {
    if (!confirm('Eliminar este tratamento? Esta ação não pode ser revertida.')) return;
    await onDelete?.(id);
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {showPatient && <th className="data-th">Doente</th>}
              <th className="data-th">Código TANOMD</th>
              <th className="data-th">Descrição</th>
              <th className="data-th">Fase</th>
              <th className="data-th">Estado</th>
              <th className="data-th" style={{ textAlign: 'right' }}>
                Valor
              </th>
              <th className="data-th"></th>
            </tr>
          </thead>
          <tbody>
            {treatments.map((t) => (
              <tr key={t.id}>
                {showPatient && (
                  <td className="data-td" style={{ fontWeight: 600 }}>
                    {t.patient_name}
                  </td>
                )}
                <td className="data-td">
                  {t.treatment_code ? (
                    <span
                      style={{
                        fontFamily: '"JetBrains Mono",monospace',
                        fontSize: 11,
                        background: '#EAE6FF',
                        color: '#5243AA',
                        borderRadius: 4,
                        padding: '2px 7px',
                        fontWeight: 600,
                      }}
                    >
                      {t.treatment_code}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="data-td" style={{ fontWeight: 500 }}>
                  {t.description}
                </td>
                <td className="data-td" style={{ color: '#5E6C84' }}>
                  Fase {t.phase}
                </td>
                <td className="data-td">
                  <Badge s={t.status} />
                </td>
                <td className="data-td" style={{ textAlign: 'right', fontWeight: 700 }}>
                  €{Number(t.fee).toLocaleString('pt-PT', { minimumFractionDigits: 2 })}
                </td>
                <td className="data-td">
                  <div className="flex gap-2 justify-end">
                    <button type="button" onClick={() => openEdit(t)} className="btn btn-ghost btn-sm">
                      Editar
                    </button>
                    {onDelete && (
                      <button type="button" onClick={() => handleDelete(t.id)} className="btn btn-danger btn-sm">
                        ×
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {treatments.length === 0 && (
              <tr>
                <td colSpan={showPatient ? 7 : 6} className="data-td text-center py-12" style={{ color: '#97A0AF' }}>
                  Sem tratamentos encontrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={`Editar — ${editing.description}`} onClose={() => setEditing(null)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Código TANOMD">
              <Sel
                value={form.treatmentCode}
                onChange={(e) => {
                  const tc = TANOMD_CODES.find((a) => a.code === e.target.value);
                  setForm((p) => ({
                    ...p,
                    treatmentCode: e.target.value,
                    description: tc?.desc || p.description,
                    fee: tc?.fee || p.fee,
                  }));
                }}
              >
                <option value="">— Personalizado —</option>
                {TANOMD_CODES.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.desc}
                  </option>
                ))}
              </Sel>
            </FormField>
          </div>
          <FormField label="Descrição">
            <Inp
              value={form.description}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FormField label="Fase">
              <Sel value={form.phase} onChange={(e) => setForm((p) => ({ ...p, phase: Number(e.target.value) }))}>
                <option value={1}>1 — Urgência</option>
                <option value={2}>2 — Restauradora</option>
                <option value={3}>3 — Estética</option>
              </Sel>
            </FormField>
            <FormField label="Estado">
              <Sel value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
                {['proposto', 'aceite', 'concluído'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Sel>
            </FormField>
            <FormField label="Valor (€)">
              <Inp
                type="number"
                value={form.fee}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, fee: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Notas">
            <Inp
              value={form.notes}
              placeholder="Notas opcionais..."
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={saveEdit} disabled={saving}>
              {saving ? 'A guardar…' : 'Guardar Alterações'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setEditing(null)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}
    </>
  );
}
