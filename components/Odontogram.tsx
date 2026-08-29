'use client';
import { Check, Circle } from 'lucide-react';
import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import type { ToothState, Treatment } from '@/lib/types';
import { Badge, FormField, GhostBtn, Inp, Modal, PrimaryBtn, Sel, Textarea } from './ui';

const UPPER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LOWER = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];

interface OdontogramProps {
  patientId?: string;
  teeth?: Record<number, ToothState>;
  treatments?: Treatment[];
  onTeethChange?: (num: number, patch: Partial<ToothState>) => Promise<void> | void;
  onAddTreatment?: (data: Record<string, unknown>) => Promise<void> | void;
  readOnly?: boolean;
}

export default function Odontogram({
  patientId: _patientId,
  teeth = {},
  treatments = [],
  onTeethChange,
  onAddTreatment,
  readOnly = false,
}: OdontogramProps) {
  const { settings } = useAuth();
  const TANOMD_CODES = settings?.TANOMD_CODES || [];
  const TOOTH_CONDITIONS = settings?.TOOTH_CONDITIONS || [];

  const COND = useMemo(() => {
    const c = Object.fromEntries(TOOTH_CONDITIONS.map((x) => [x.key, x]));
    if (!c.healthy) c.healthy = { key: 'healthy', label: 'Saudável', color: '#00A3BF' };
    return c;
  }, [TOOTH_CONDITIONS]);

  const [selected, setSelected] = useState<number | null>(null);
  const [addModal, setAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    treatmentCode: string;
    description: string;
    phase: number;
    fee: string | number;
    notes: string;
  }>({ treatmentCode: '', description: '', phase: 1, fee: '', notes: '' });
  const [editSurfaces, setEditSurfaces] = useState<string[]>([]);
  const [editNotes, setEditNotes] = useState('');

  function getT(num: number) {
    return teeth[num] || { condition: 'healthy', surfaces: [], notes: '' };
  }

  function ToothIcon({
    color,
    fill,
    dashed,
    selected,
  }: {
    color?: string;
    fill?: string;
    dashed?: boolean;
    selected?: boolean;
  }) {
    return (
      <svg
        width="26"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ display: 'block', filter: selected ? `drop-shadow(0 2px 6px ${color}33)` : 'none' }}
      >
        <path
          d="M8.4 3.2c-1.8.7-3 2.8-3 5.2 0 1.8.4 3.5.8 5 .6 2.2 1.2 4.2 1.4 6.2.1 1.6 1.1 2.4 2 2.4 1.1 0 1.7-1.1 2-2.4l.6-2.8c.2-.9.6-1.3 1.2-1.3s1 .4 1.2 1.3l.6 2.8c.3 1.3.9 2.4 2 2.4.9 0 1.9-.8 2-2.4.2-2 .8-4 1.4-6.2.4-1.5.8-3.2.8-5 0-2.4-1.2-4.5-3-5.2-1.7-.7-3.2-.3-4.1.2-.6.3-1.2.3-1.8 0-.9-.5-2.4-.9-4.1-.2Z"
          stroke={color}
          strokeWidth={selected ? '2.3' : '2'}
          strokeLinejoin="round"
          strokeDasharray={dashed ? '3 2' : undefined}
          fill={fill || 'none'}
        />
      </svg>
    );
  }

  async function setCondition(condition: string) {
    if (readOnly || !onTeethChange || !selected) return;
    setSaving(true);
    await onTeethChange(selected, { condition, surfaces: editSurfaces, notes: editNotes });
    setSaving(false);
  }

  async function addTreatment() {
    if (!onAddTreatment) return;
    const tc = TANOMD_CODES.find((a) => a.code === form.treatmentCode);
    await onAddTreatment({
      toothNum: selected,
      treatmentCode: form.treatmentCode || null,
      description: form.description || tc?.desc || 'Tratamento personalizado',
      phase: Number(form.phase),
      fee: Number(form.fee) || tc?.fee || 0,
      notes: form.notes,
    });
    setAddModal(false);
    setForm({ treatmentCode: '', description: '', phase: 1, fee: '', notes: '' });
  }

  function ToothBtn({ num }: { num: number }) {
    const t = getT(num);
    const cond = t.condition || 'healthy';
    const meta = COND[cond] || COND.healthy;
    const isSelected = selected === num;
    const hasTx = treatments.some((t) => t.tooth_num === num && t.status !== 'completed');
    const isHealthy = cond === 'healthy';
    const isMissing = cond === 'missing';

    return (
      <button
        type="button"
        disabled={readOnly}
        onClick={() => !readOnly && setSelected(isSelected ? null : num)}
        onKeyDown={(e) => {
          if (!readOnly && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setSelected(isSelected ? null : num);
          }
        }}
        title={`#${num} · ${meta.label || cond}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          font: 'inherit',
          cursor: readOnly ? 'default' : 'pointer',
          padding: '7px 6px',
          borderRadius: 10,
          background: isSelected ? `${meta.color}10` : 'transparent',
          border: `1.5px solid ${isSelected ? `${meta.color}66` : 'transparent'}`,
          transition: 'transform 0.12s, background 0.12s, border-color 0.12s',
          position: 'relative',
          userSelect: 'none',
          transform: isSelected ? 'translateY(-1px)' : 'none',
        }}
      >
        {hasTx && (
          <span
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#FF8B00',
              border: '1.5px solid white',
              zIndex: 1,
            }}
          />
        )}
        <div style={{ opacity: isHealthy ? 0.25 : 1, transition: 'opacity 0.12s' }}>
          <ToothIcon
            color={isMissing ? '#C1C7D0' : meta.color}
            fill={isHealthy || isMissing ? 'none' : `${meta.color}1A`}
            dashed={isMissing}
            selected={isSelected}
          />
        </div>
        <div
          style={{
            fontSize: 8.5,
            color: isSelected ? meta.color : '#97A0AF',
            fontFamily: '"JetBrains Mono",monospace',
            fontWeight: 600,
          }}
        >
          {num}
        </div>
      </button>
    );
  }

  const sel_t = selected ? getT(selected) : null;
  const selMeta = sel_t ? COND[sel_t.condition] || COND.healthy : null;
  const selTreatments: Treatment[] = selected ? treatments.filter((t) => t.tooth_num === selected) : [];
  const selSurfaces = Array.isArray(sel_t?.surfaces) ? sel_t.surfaces : [];
  const selNotes = sel_t?.notes || '';

  useEffect(() => {
    if (!selected) return;
    setEditSurfaces(selSurfaces);
    setEditNotes(selNotes);
  }, [selected, selNotes, selSurfaces]);

  function toggleSurface(code: string) {
    setEditSurfaces((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code]));
  }

  async function saveDetails() {
    if (readOnly || !onTeethChange || !selected) return;
    setSaving(true);
    await onTeethChange(selected, {
      condition: sel_t?.condition || 'healthy',
      surfaces: editSurfaces,
      notes: editNotes,
    });
    setSaving(false);
  }

  const dirty = selected
    ? editNotes !== selNotes || editSurfaces.slice().sort().join(',') !== selSurfaces.slice().sort().join(',')
    : false;
  const teethArr: ToothState[] = Object.values(teeth);
  const counts = {
    affected: teethArr.filter((t) => t.condition !== 'healthy').length,
    caries: teethArr.filter((t) => t.condition === 'caries').length,
    missing: teethArr.filter((t) => t.condition === 'missing').length,
    rc: teethArr.filter((t) => t.condition === 'root_canal').length,
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 16 }}>
        <div className="card p-6">
          <div className="text-center section-label mb-3">MAXILAR — Dentes 1–16</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 3, flexWrap: 'wrap', marginBottom: 10 }}>
            {UPPER.map((n) => (
              <ToothBtn key={n} num={n} />
            ))}
          </div>
          <div style={{ height: 1, background: '#EBECF0', margin: '10px 32px', position: 'relative' }}>
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: -8,
                transform: 'translateX(-50%)',
                fontSize: 10,
                color: '#97A0AF',
                background: 'white',
                padding: '0 8px',
              }}
            >
              LINHA MÉDIA
            </div>
          </div>
          <div className="text-center section-label mb-3 mt-2">MANDIBULAR — Dentes 17–32</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 3, flexWrap: 'wrap' }}>
            {LOWER.map((n) => (
              <ToothBtn key={n} num={n} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
            {TOOTH_CONDITIONS.map((c) => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: c.color,
                    opacity: c.key === 'healthy' ? 0.22 : 1,
                  }}
                />
                <span style={{ fontSize: 10, color: '#5E6C84' }}>{c.label}</span>
              </div>
            ))}
          </div>
          <div className="text-center mt-2" style={{ fontSize: 10, color: '#97A0AF' }}>
            <Circle size={8} fill="#FF8B00" color="#FF8B00" /> Ponto laranja = tratamento ativo nesse dente
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card p-4">
            <div className="section-label mb-3">RESUMO DO MAPA</div>
            {[
              ['Afetados', counts.affected, '#0052CC'],
              ['Cáries', counts.caries, '#DE350B'],
              ['Em falta', counts.missing, '#5E6C84'],
              ['Desvitalizações', counts.rc, '#00875A'],
            ].map(([k, v, c]) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '7px 0',
                  borderBottom: '1px solid #F4F7FA',
                }}
              >
                <span style={{ fontSize: 13, color: '#5E6C84' }}>{k}</span>
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 800,
                    color: String(c),
                    fontFamily: '"Plus Jakarta Sans",sans-serif',
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>

          {selected ? (
            <div className="card p-4" style={{ borderTop: `3px solid ${selMeta?.color || '#0052CC'}` }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#172B4D',
                  marginBottom: 4,
                  fontFamily: '"Plus Jakarta Sans",sans-serif',
                }}
              >
                Dente #{selected}
              </div>
              <div style={{ fontSize: 12, color: '#5E6C84', marginBottom: 12 }}>
                Condição: <strong style={{ color: selMeta?.color }}>{selMeta?.label}</strong>
              </div>

              {selTreatments.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div className="section-label mb-2">TRATAMENTOS</div>
                  {selTreatments.map((t) => (
                    <div
                      key={t.id}
                      style={{
                        background: '#F4F7FA',
                        borderRadius: 5,
                        padding: '6px 10px',
                        marginBottom: 4,
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: 12, color: '#172B4D' }}>{t.description}</span>
                      <Badge s={t.status} />
                    </div>
                  ))}
                </div>
              )}

              {!readOnly && (
                <>
                  <div className="section-label mb-2">DEFINIR CONDIÇÃO</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                    {TOOTH_CONDITIONS.map((c) => {
                      const cur = getT(selected).condition === c.key;
                      return (
                        <button
                          type="button"
                          key={c.key}
                          onClick={() => setCondition(c.key)}
                          disabled={saving}
                          style={{
                            textAlign: 'left',
                            padding: '7px 10px',
                            background: cur ? `${c.color}12` : 'white',
                            border: `1.5px solid ${cur ? c.color : '#DFE1E6'}`,
                            borderRadius: 6,
                            color: c.color,
                            fontSize: 12,
                            fontWeight: cur ? 700 : 500,
                            cursor: saving ? 'wait' : 'pointer',
                            fontFamily: 'inherit',
                            transition: 'all 0.1s',
                          }}
                        >
                          {cur && <Check size={12} style={{ display: 'inline' }} />} {c.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="section-label mb-2">SUPERFÍCIES</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    {['O', 'M', 'D', 'B', 'L'].map((s) => {
                      const active = editSurfaces.includes(s);
                      return (
                        <button
                          type="button"
                          key={s}
                          onClick={() => toggleSurface(s)}
                          disabled={saving}
                          style={{
                            padding: '6px 12px',
                            fontSize: 12,
                            fontWeight: 800,
                            borderRadius: 999,
                            cursor: saving ? 'wait' : 'pointer',
                            fontFamily: '"JetBrains Mono",monospace',
                            background: active ? `${selMeta?.color || '#0052CC'}12` : 'white',
                            border: `1.5px solid ${active ? selMeta?.color || '#0052CC' : '#DFE1E6'}`,
                            color: active ? selMeta?.color || '#0052CC' : '#5E6C84',
                            transition: 'all 0.1s',
                          }}
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>

                  <div className="section-label mb-2">NOTAS</div>
                  <Textarea
                    value={editNotes}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setEditNotes(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <PrimaryBtn
                      onClick={saveDetails}
                      disabled={saving || !dirty}
                      style={{ justifyContent: 'center', flex: 1 }}
                    >
                      {saving ? 'A guardar…' : 'Guardar Detalhes do Dente'}
                    </PrimaryBtn>
                  </div>

                  <button
                    type="button"
                    onClick={() => setAddModal(true)}
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center' }}
                  >
                    + Adicionar Tratamento ao Dente {selected}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div
              style={{
                border: '2px dashed #DFE1E6',
                borderRadius: 8,
                padding: '28px 16px',
                textAlign: 'center',
                color: '#97A0AF',
                fontSize: 12,
                background: 'white',
              }}
            >
              {readOnly
                ? 'Clique num dente para ver detalhes.'
                : 'Clique num dente para assinalar uma condição ou adicionar um tratamento.'}
            </div>
          )}
        </div>
      </div>

      {/* Add treatment modal */}
      {addModal && (
        <Modal title={`Adicionar Tratamento — Dente #${selected}`} onClose={() => setAddModal(false)}>
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
              <option value="">— Selecionar procedimento —</option>
              {TANOMD_CODES.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} · {a.desc} (€{a.fee})
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Descrição">
            <Inp
              value={form.description}
              placeholder="Descrição do procedimento"
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, description: e.target.value }))}
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Fase">
              <Sel value={form.phase} onChange={(e) => setForm((p) => ({ ...p, phase: Number(e.target.value) }))}>
                <option value={1}>Fase 1 — Urgência</option>
                <option value={2}>Fase 2 — Restauradora</option>
                <option value={3}>Fase 3 — Estética</option>
              </Sel>
            </FormField>
            <FormField label="Valor (€)">
              <Inp
                type="number"
                value={form.fee}
                placeholder="0.00"
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, fee: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Notas (opcional)">
            <Inp
              value={form.notes}
              placeholder="Notas clínicas..."
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </FormField>
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={addTreatment}>Adicionar Tratamento</PrimaryBtn>
            <GhostBtn onClick={() => setAddModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}
    </>
  );
}
