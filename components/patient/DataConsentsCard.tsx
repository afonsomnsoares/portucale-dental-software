'use client';
import { useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { useQuery } from '@/hooks/useQuery';

interface DataConsent {
  type: string;
  label: string;
  given: boolean;
  givenAt: string | null;
}

interface DataConsentsCardProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  patientId: string;
}

// O que o doente autorizou, fora das mensagens da própria consulta. Sem isto registado,
// a reativação automática e as propostas noutra unidade do grupo não o contactam nunca —
// ver app/api/patients/[id]/data-consents. Cada caixa grava logo: é um registo legal com
// data, não uma preferência que se edita e guarda em conjunto.
export default function DataConsentsCard({ api, patientId }: DataConsentsCardProps) {
  const consentsQuery = useQuery<DataConsent[]>(`/patients/${patientId}/data-consents`);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function toggle(c: DataConsent) {
    setSaving(c.type);
    setError('');
    try {
      await api(`/patients/${patientId}/data-consents`, { method: 'PUT', body: { type: c.type, given: !c.given } });
      consentsQuery.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível gravar o consentimento.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div
      className="card"
      style={{ padding: '12px 16px', border: '1px solid var(--border-subtle)', gridColumn: '1 / -1' }}
    >
      <div className="section-label" style={{ marginBottom: 8 }}>
        Consentimentos (RGPD)
      </div>
      {consentsQuery.loading && !consentsQuery.data ? (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>A carregar…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(consentsQuery.data ?? []).map((c) => (
            <label key={c.type} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)' }}>
              <input type="checkbox" checked={c.given} disabled={saving === c.type} onChange={() => toggle(c)} />
              <span>{c.label}</span>
              {c.given && c.givenAt && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                  desde {String(c.givenAt).slice(0, 10)}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 6, fontSize: 'var(--text-xs)', color: 'var(--urgency-critical)' }}>{error}</div>
      )}
    </div>
  );
}
