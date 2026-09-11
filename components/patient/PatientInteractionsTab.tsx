'use client';
import { type ChangeEvent, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { Badge, Empty, FormField, PrimaryBtn, Sel, Textarea } from '@/components/ui';
import type { InteractionChannel, InteractionDirection, PatientInteraction } from '@/lib/types';

interface PatientInteractionsTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  patientId: string;
  interactions: PatientInteraction[];
  onChanged: () => void;
}

const CHANNEL_LABELS: Record<InteractionChannel, string> = {
  phone: 'Chamada',
  email: 'Email',
  sms: 'SMS',
  in_person: 'Presencial',
  other: 'Outro',
};

export default function PatientInteractionsTab({
  api,
  patientId,
  interactions,
  onChanged,
}: PatientInteractionsTabProps) {
  const [channel, setChannel] = useState<InteractionChannel>('phone');
  const [direction, setDirection] = useState<InteractionDirection>('outbound');
  const [summary, setSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function log() {
    if (!summary.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api('/patient-interactions', {
        method: 'POST',
        body: { patientId, channel, direction, summary: summary.trim() },
      });
      onChanged();
      setSummary('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao registar interação.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid-pair" style={{ gap: 16 }}>
      <div className="card p-5">
        <div className="section-label mb-3">REGISTAR INTERAÇÃO</div>
        <div className="grid-pair" style={{ gap: 12 }}>
          <FormField label="Canal">
            <Sel value={channel} onChange={(e) => setChannel(e.target.value as InteractionChannel)}>
              {Object.entries(CHANNEL_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Sel>
          </FormField>
          <FormField label="Direção">
            <Sel value={direction} onChange={(e) => setDirection(e.target.value as InteractionDirection)}>
              <option value="outbound">Efetuada (nós → paciente)</option>
              <option value="inbound">Recebida (paciente → nós)</option>
            </Sel>
          </FormField>
        </div>
        <FormField label="Resumo">
          <Textarea
            value={summary}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setSummary(e.target.value)}
            placeholder="ex: Ligou a confirmar consulta de amanhã"
            style={{ minHeight: 80 }}
          />
        </FormField>
        {error && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--urgency-critical)',
              fontWeight: 'var(--weight-bold)',
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}
        <PrimaryBtn onClick={log} disabled={saving || !summary.trim()} style={{ justifyContent: 'center' }}>
          {saving ? 'A registar…' : 'Registar'}
        </PrimaryBtn>
      </div>

      <div className="card p-5">
        <div className="section-label mb-4">HISTÓRICO</div>
        {!interactions.length ? (
          <Empty message="Sem interações registadas." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {interactions.map((i) => (
              <div key={i.id} style={{ borderBottom: '1px solid var(--bg-page)', paddingBottom: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                  <Badge bg="var(--cat-teal-bg)" color="var(--cat-teal)" label={CHANNEL_LABELS[i.channel]} />
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                    {i.direction === 'inbound' ? 'Recebida' : 'Efetuada'}
                  </span>
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                    {new Date(i.occurred_at).toLocaleString('pt-PT')}
                  </span>
                  {i.created_by_name && (
                    <span
                      style={{
                        fontSize: 'var(--text-2xs)',
                        color: 'var(--accent)',
                        fontWeight: 'var(--weight-semibold)',
                      }}
                    >
                      {i.created_by_name}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{i.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
