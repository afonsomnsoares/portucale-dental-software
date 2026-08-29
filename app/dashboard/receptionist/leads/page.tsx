'use client';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, GhostBtn, Inp, PageHeader, PrimaryBtn, Spinner } from '@/components/ui';
import type { Lead } from '@/lib/types';

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
                <th className="data-th" style={{ textAlign: 'right' }}>
                  Estado
                </th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td className="data-td" style={{ fontWeight: 600 }}>
                    {lead.name}
                  </td>
                  <td className="data-td">{lead.phone || lead.email || '—'}</td>
                  <td className="data-td">{lead.source || '—'}</td>
                  <td className="data-td">{String(lead.created_at).slice(0, 10)}</td>
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
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
