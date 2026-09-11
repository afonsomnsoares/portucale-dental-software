'use client';
import { type ChangeEvent, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  Badge,
  DataTable,
  Empty,
  ErrorState,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Spinner,
  TD,
} from '@/components/ui';
import { useInvalidate, useQuery } from '@/hooks/useQuery';
import type { LeadCaptureSource, LeadCaptureSourceWithToken } from '@/lib/types';

// Fontes de captação de leads da própria clínica — a mesma página sem o seletor de
// clínica da versão de plataforma (components/super-admin/pages/LeadSources.tsx).
// app/api/lead-sources só aceita ?tenantId= / body.tenantId de um super_admin.
export default function ClinicLeadSourcesPage() {
  const { api } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<LeadCaptureSourceWithToken | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sourcesQuery = useQuery<LeadCaptureSource[]>('/lead-sources');
  const sources = sourcesQuery.data ?? [];
  const invalidate = useInvalidate();

  async function create() {
    if (!label.trim()) return;
    setSaving(true);
    setError('');
    try {
      const row = await api('/lead-sources', {
        method: 'POST',
        body: { label: label.trim() },
      });
      invalidate('/lead-sources');
      setCreateOpen(false);
      setLabel('');
      setRevealed(row);
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar fonte.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(source: LeadCaptureSource) {
    setBusyId(source.id);
    setError('');
    try {
      await api(`/lead-sources/${source.id}`, { method: 'PUT', body: { active: !source.active } });
      invalidate('/lead-sources');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível mudar o estado da fonte.');
    }
    setBusyId(null);
  }

  async function copyToken() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const endpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/public/leads` : '/api/public/leads';

  return (
    <div>
      <PageHeader
        title="Fontes de Leads"
        sub="Tokens para um site, formulário ou landing page criar leads automaticamente, sem sessão"
        action="+ Nova Fonte"
        onAction={() => {
          setCreateOpen(true);
          setError('');
        }}
      />

      {sourcesQuery.error ? (
        <ErrorState
          error={sourcesQuery.error}
          onRetry={sourcesQuery.refetch}
          message="Não foi possível ler as fontes de angariação."
        />
      ) : sourcesQuery.loading ? (
        <Spinner />
      ) : !sources.length ? (
        <Empty message="Sem fontes de captação. Cria a primeira para começares a receber leads automaticamente." />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <DataTable
            cols={['Rótulo', 'Token', 'Estado', 'Leads Capturados', 'Último Uso', '']}
            rows={sources.map((s) => (
              <tr key={s.id}>
                <TD bold>{s.label}</TD>
                <TD mono>{s.token_prefix}…</TD>
                <TD>
                  <Badge
                    label={s.active ? 'Ativo' : 'Inativo'}
                    bg={s.active ? 'var(--urgency-ok-bg)' : 'var(--bg-sunken)'}
                    color={s.active ? 'var(--urgency-ok)' : 'var(--text-secondary)'}
                  />
                </TD>
                <TD right>{s.lead_count}</TD>
                <TD muted>{s.last_used_at ? new Date(s.last_used_at).toLocaleString('pt-PT') : 'Nunca'}</TD>
                <TD right>
                  <GhostBtn
                    disabled={busyId === s.id}
                    onClick={() => toggleActive(s)}
                    style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}
                  >
                    {busyId === s.id ? '…' : s.active ? 'Desativar' : 'Ativar'}
                  </GhostBtn>
                </TD>
              </tr>
            ))}
          />
        </div>
      )}

      {createOpen && (
        <Modal title="Nova Fonte de Captação" onClose={() => setCreateOpen(false)}>
          <FormField label="Rótulo" hint="ex: Site, Formulário de contacto, Google Ads">
            <Inp
              value={label}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setLabel(e.target.value)}
              placeholder="Site"
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
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setCreateOpen(false)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={create} disabled={saving || !label.trim()}>
              {saving ? 'A criar…' : 'Criar'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}

      {revealed && (
        <Modal title={`Fonte "${revealed.label}" criada`} onClose={() => setRevealed(null)} width={640}>
          <div
            className="rounded px-4 py-3 mb-4 text-sm"
            style={{
              background: 'var(--urgency-soon-bg)',
              color: 'var(--urgency-soon)',
              border: '1px solid var(--urgency-soon-border)',
            }}
          >
            <strong>Este token só é mostrado uma vez.</strong> Copia-o agora — não é possível voltar a vê-lo depois de
            fechares esta janela.
          </div>

          <div className="section-label mb-1.5">Token</div>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              background: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-control)',
              padding: '10px 12px',
              marginBottom: 16,
            }}
          >
            <code style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all', flex: 1 }}>{revealed.token}</code>
            <GhostBtn onClick={copyToken} style={{ padding: '5px 10px', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
              {copied ? 'Copiado ✓' : 'Copiar'}
            </GhostBtn>
          </div>

          <div className="section-label mb-1.5">Como usar (exemplo)</div>
          <pre
            style={{
              fontSize: 'var(--text-2xs)',
              background: 'var(--text-primary)',
              color: 'var(--bg-sunken)',
              padding: '12px 14px',
              borderRadius: 'var(--radius-control)',
              overflowX: 'auto',
              whiteSpace: 'pre',
              lineHeight: 1.55,
            }}
          >
            {`fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer ${revealed.token}"
  },
  body: JSON.stringify({
    name: "Nome do contacto",
    phone: "912345678",   // ou email
    message: "Mensagem opcional"
  })
});`}
          </pre>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <PrimaryBtn onClick={() => setRevealed(null)}>Fechar</PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
