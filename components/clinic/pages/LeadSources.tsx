'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  Badge,
  DataTable,
  Empty,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Spinner,
  TD,
} from '@/components/ui';
import type { LeadCaptureSource, LeadCaptureSourceWithToken } from '@/lib/types';

// Fontes de captação de leads da própria clínica — a mesma página sem o seletor de
// clínica da versão de plataforma (components/super-admin/pages/LeadSources.tsx).
// app/api/lead-sources só aceita ?tenantId= / body.tenantId de um super_admin.
export default function ClinicLeadSourcesPage() {
  const { api } = useAuth();
  const [sources, setSources] = useState<LeadCaptureSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<LeadCaptureSourceWithToken | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await api('/lead-sources').catch(() => []);
    setSources(rows || []);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!label.trim()) return;
    setSaving(true);
    setError('');
    try {
      const row = await api('/lead-sources', {
        method: 'POST',
        body: { label: label.trim() },
      });
      setSources((prev) => [row, ...prev]);
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
    const row = await api(`/lead-sources/${source.id}`, {
      method: 'PUT',
      body: { active: !source.active },
    }).catch(() => null);
    if (row) setSources((prev) => prev.map((s) => (s.id === row.id ? row : s)));
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

      {loading ? (
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
                    bg={s.active ? 'var(--green-bg)' : 'var(--surface-2)'}
                    color={s.active ? 'var(--green)' : 'var(--ink-2)'}
                  />
                </TD>
                <TD right>{s.lead_count}</TD>
                <TD muted>{s.last_used_at ? new Date(s.last_used_at).toLocaleString('pt-PT') : 'Nunca'}</TD>
                <TD right>
                  <GhostBtn
                    disabled={busyId === s.id}
                    onClick={() => toggleActive(s)}
                    style={{ padding: '5px 10px', fontSize: 12 }}
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
          {error && <div style={{ fontSize: 12, color: '#DE350B', fontWeight: 700, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
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
            style={{ background: 'var(--amber-bg)', color: 'var(--amber)', border: '1px solid rgba(217,119,6,0.22)' }}
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
              background: '#F4F7FA',
              border: '1px solid #DFE1E6',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 16,
            }}
          >
            <code style={{ fontSize: 12, wordBreak: 'break-all', flex: 1 }}>{revealed.token}</code>
            <GhostBtn onClick={copyToken} style={{ padding: '5px 10px', fontSize: 12, flexShrink: 0 }}>
              {copied ? 'Copiado ✓' : 'Copiar'}
            </GhostBtn>
          </div>

          <div className="section-label mb-1.5">Como usar (exemplo)</div>
          <pre
            style={{
              fontSize: 11,
              background: '#172B4D',
              color: '#EBECF0',
              padding: '12px 14px',
              borderRadius: 8,
              overflowX: 'auto',
              whiteSpace: 'pre',
              lineHeight: 1.6,
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
