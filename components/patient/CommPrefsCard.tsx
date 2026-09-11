'use client';
import { useEffect, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { GhostBtn, PrimaryBtn, Sel } from '@/components/ui';
import type { CommPrefs, Patient } from '@/lib/types';

interface CommPrefsCardProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  patient: Patient;
  onUpdated: (p: Patient) => void;
}

// Dois canais, que são os dois que o agente tem: SMS e chamada. O e-mail e o WhatsApp
// saíram com a migração 052 — o campo `email` do doente continua na ficha, mas deixou de
// ser uma via por onde a clínica fale com ele, e oferecer aqui uma preferência que o
// sistema não consegue honrar é pior do que não a oferecer.
const CHANNELS = [
  { value: '', label: '— Sem preferência —' },
  { value: 'sms', label: 'SMS' },
  { value: 'phone', label: 'Chamada' },
];
const DO_NOT_CONTACT_OPTIONS: Array<{ value: 'sms' | 'phone'; label: string }> = [
  { value: 'sms', label: 'SMS' },
  { value: 'phone', label: 'Chamada' },
];

export default function CommPrefsCard({ api, patient, onUpdated }: CommPrefsCardProps) {
  const [prefs, setPrefs] = useState<CommPrefs>(patient.comm_prefs || {});
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setPrefs(patient.comm_prefs || {});
    setEditing(false);
  }, [patient.comm_prefs]);

  function toggleDoNotContact(channel: 'sms' | 'phone') {
    setPrefs((prev) => {
      const current = prev.doNotContact || [];
      const next = current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel];
      return { ...prev, doNotContact: next };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await api(`/patients/${patient.id}`, { method: 'PUT', body: { ...patient, commPrefs: prefs } });
      onUpdated(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="card"
      style={{
        padding: '14px 18px',
        border: '1px solid var(--border-subtle)',
        gridColumn: '1 / -1',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-label">Preferências de Comunicação</div>
        {!editing && (
          <GhostBtn onClick={() => setEditing(true)} style={{ padding: '6px 10px', fontSize: 'var(--text-xs)' }}>
            Editar
          </GhostBtn>
        )}
      </div>

      {!editing ? (
        <div
          style={{
            display: 'flex',
            gap: 20,
            flexWrap: 'wrap',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-primary)',
          }}
        >
          <div>
            Canal preferido:{' '}
            <strong>{CHANNELS.find((c) => c.value === (prefs.preferredChannel || ''))?.label || '—'}</strong>
          </div>
          <div>
            Não contactar por:{' '}
            <strong>
              {prefs.doNotContact?.length
                ? prefs.doNotContact.map((c) => DO_NOT_CONTACT_OPTIONS.find((o) => o.value === c)?.label).join(', ')
                : '—'}
            </strong>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 4 }}>
                Canal preferido
              </div>
              <Sel
                value={prefs.preferredChannel || ''}
                onChange={(e) =>
                  setPrefs((prev) => ({
                    ...prev,
                    preferredChannel: (e.target.value || undefined) as CommPrefs['preferredChannel'],
                  }))
                }
              >
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Sel>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginBottom: 4 }}>
                Não contactar por
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                {DO_NOT_CONTACT_OPTIONS.map((o) => (
                  <label
                    key={o.value}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)' }}
                  >
                    <input
                      type="checkbox"
                      checked={!!prefs.doNotContact?.includes(o.value)}
                      onChange={() => toggleDoNotContact(o.value)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={save} disabled={saving} style={{ padding: '6px 14px', fontSize: 'var(--text-xs)' }}>
              {saving ? 'A guardar…' : 'Guardar'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setEditing(false)} style={{ padding: '6px 14px', fontSize: 'var(--text-xs)' }}>
              Cancelar
            </GhostBtn>
          </div>
        </div>
      )}
    </div>
  );
}
