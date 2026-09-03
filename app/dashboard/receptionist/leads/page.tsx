'use client';
import { type ChangeEvent, type FormEvent, Fragment, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, Empty, GhostBtn, Inp, PageHeader, PrimaryBtn, Spinner } from '@/components/ui';
import type { Lead } from '@/lib/types';

const QUALIFICATION_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  hot: { label: 'Quente', bg: '#FFEBE6', color: '#DE350B' },
  warm: { label: 'Morno', bg: '#FFF7E6', color: '#B25000' },
  cold: { label: 'Frio', bg: '#F4F7FA', color: '#5E6C84' },
};

interface LeadForm {
  name: string;
  phone: string;
  email: string;
  source: string;
  notes: string;
}

const emptyForm: LeadForm = { name: '', phone: '', email: '', source: '', notes: '' };

export default function ReceptionLeadsPage() {
  const { api } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [form, setForm] = useState<LeadForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await api('/leads').catch(() => []);
    setLeads(rows || []);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  function update(field: keyof LeadForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function createLead(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api('/leads', { method: 'POST', body: form });
      setForm(emptyForm);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível guardar o lead.');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    await api('/leads', { method: 'PATCH', body: { id, status } }).catch(() => null);
    load();
  }

  const [sendingId, setSendingId] = useState<string | null>(null);

  async function sendReply(lead: Lead) {
    setSendingId(lead.id);
    try {
      await api(`/leads/${lead.id}/send-reply`, { method: 'POST', body: {} });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível enviar a resposta.');
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Leads" sub="Contactos que ainda não marcaram uma primeira consulta">
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      <form className="card p-5 mb-4" onSubmit={createLead}>
        <div className="section-label mb-3">Registar lead</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <Inp
            value={form.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('name', e.target.value)}
            placeholder="Nome *"
            required
          />
          <Inp
            value={form.phone}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('phone', e.target.value)}
            placeholder="Telefone"
          />
          <Inp
            value={form.email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('email', e.target.value)}
            placeholder="Email"
            type="email"
          />
          <Inp
            value={form.source}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('source', e.target.value)}
            placeholder="Origem (opcional)"
          />
        </div>
        <div className="flex items-center gap-3 mt-3">
          <Inp
            value={form.notes}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('notes', e.target.value)}
            placeholder="Notas (opcional)"
          />
          <PrimaryBtn type="submit" disabled={saving}>
            {saving ? 'A guardar...' : 'Adicionar lead'}
          </PrimaryBtn>
        </div>
        {error && (
          <div className="text-sm mt-3" style={{ color: '#DE350B', fontWeight: 700 }}>
            {error}
          </div>
        )}
      </form>

      {loading ? (
        <Spinner />
      ) : leads.length === 0 ? (
        <Empty message="Não existem leads abertos." />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className="data-th">Nome</th>
                <th className="data-th">Contacto</th>
                <th className="data-th">Origem</th>
                <th className="data-th">Registado</th>
                <th className="data-th">Triagem IA</th>
                <th className="data-th" style={{ textAlign: 'right' }}>
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const qual = lead.ai_qualification ? QUALIFICATION_BADGE[lead.ai_qualification] : null;
                const hasDraft = !!lead.ai_draft_reply && !lead.ai_reply_sent_at;
                return (
                  <Fragment key={lead.id}>
                    <tr>
                      <td className="data-td" style={{ fontWeight: 600 }}>
                        {lead.name}
                      </td>
                      <td className="data-td">{lead.phone || lead.email || '—'}</td>
                      <td className="data-td">{lead.source || '—'}</td>
                      <td className="data-td">{String(lead.created_at).slice(0, 10)}</td>
                      <td className="data-td">
                        {qual ? (
                          <Badge label={qual.label} bg={qual.bg} color={qual.color} />
                        ) : (
                          <span className="text-xs" style={{ color: '#97A0AF' }}>
                            Por triar
                          </span>
                        )}
                      </td>
                      <td className="data-td" style={{ textAlign: 'right' }}>
                        <GhostBtn onClick={() => updateStatus(lead.id, 'converted')} style={{ padding: '5px 10px' }}>
                          Marcação feita
                        </GhostBtn>
                        <GhostBtn
                          onClick={() => updateStatus(lead.id, 'lost')}
                          style={{ padding: '5px 10px', marginLeft: 6 }}
                        >
                          Fechar
                        </GhostBtn>
                      </td>
                    </tr>
                    {hasDraft && (
                      <tr>
                        <td className="data-td" colSpan={6} style={{ background: '#F4F7FA' }}>
                          <div className="text-xs" style={{ color: '#5E6C84', marginBottom: 6 }}>
                            {lead.ai_intent ? `Intenção: ${lead.ai_intent} — ` : ''}Rascunho de resposta (
                            {lead.ai_draft_channel === 'sms' ? 'SMS' : 'email'}):
                          </div>
                          <div className="text-sm" style={{ marginBottom: 8 }}>
                            "{lead.ai_draft_reply}"
                          </div>
                          {lead.ai_draft_channel === 'sms' ? (
                            <PrimaryBtn
                              onClick={() => sendReply(lead)}
                              disabled={sendingId === lead.id}
                              style={{ padding: '5px 12px' }}
                            >
                              {sendingId === lead.id ? 'A enviar...' : 'Enviar por SMS'}
                            </PrimaryBtn>
                          ) : (
                            <span className="text-xs" style={{ color: '#97A0AF' }}>
                              Este lead só deixou email — envio automático ainda não existe por esse canal, copia o
                              texto acima à mão.
                            </span>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
