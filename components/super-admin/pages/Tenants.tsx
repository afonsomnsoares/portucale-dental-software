'use client';
import { type ChangeEvent, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  Badge,
  DataTable,
  ErrorState,
  ErrorText,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
} from '@/components/ui';
import { useInvalidate, useQuery } from '@/hooks/useQuery';
import type { Tenant } from '@/lib/types';

export default function TenantsPage() {
  const { api } = useAuth();
  const tenantsQuery = useQuery<Tenant[]>('/tenants');
  const tenants = tenantsQuery.data ?? [];
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', city: '', operatories: 3 });
  const [saving, setSaving] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);
  // As duas escritas desta página falhavam em silêncio: o `catch(() => null)`
  // devolvia null, o botão desprendia-se e não acontecia nada visível. Provisionar
  // uma clínica é a operação mais consequente do painel de plataforma — não pode
  // ser a que menos diz.
  const [erro, setErro] = useState('');
  const invalidate = useInvalidate();

  // Entrar na clínica: grava a clínica ativa (POST /api/tenants/enter) e leva às páginas
  // do admin. Recarrega a página em vez de navegar, para que /api/auth/me seja lido de novo
  // e o âmbito da sessão (faixa, sidebar, permissões) venha já com a clínica.
  async function enterClinic(id: string) {
    setEntering(id);
    setErro('');
    try {
      await api('/tenants/enter', { method: 'POST', body: { tenantId: id } });
      window.location.href = '/dashboard/admin';
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível entrar nesta clínica.');
      setEntering(null);
    }
  }

  async function provision() {
    setSaving(true);
    setErro('');
    try {
      await api('/tenants', { method: 'POST', body: form });
      // Invalidar em vez de acrescentar à lista à mão: a linha que o servidor
      // gravou tem campos que o formulário não conhece (id, estado, datas), e
      // remendar o array local fazia a tabela mostrar uma versão pela metade.
      invalidate('/tenants');
      setModal(false);
      setForm({ name: '', city: '', operatories: 3 });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar a clínica.');
    }
    setSaving(false);
  }

  if (tenantsQuery.error)
    return (
      <ErrorState
        error={tenantsQuery.error}
        onRetry={tenantsQuery.refetch}
        message="Não foi possível ler a lista de clínicas."
      />
    );

  const filtered = tenants.filter(
    (t) => t.name.toLowerCase().includes(search.toLowerCase()) || t.city.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="Clínicas"
        sub="Criar clínicas e entrar em cada uma para ver o que lá se passa"
        action="+ Nova clínica"
        onAction={() => setModal(true)}
      />
      <div style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ maxWidth: 300 }}
          placeholder="Procurar clínica ou cidade…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="card" style={{ padding: 0 }}>
        {tenantsQuery.loading ? (
          <Spinner />
        ) : (
          <DataTable
            cols={['Clínica', 'Cidade', 'Doentes', 'Estado', 'Disponibilidade', 'Criada', '']}
            rows={filtered.map((t) => (
              <tr key={t.id}>
                <td className="data-td" style={{ fontWeight: 'var(--weight-semibold)' }}>
                  {t.name}
                </td>
                <td className="data-td" style={{ color: 'var(--text-secondary)' }}>
                  {t.city}
                </td>
                <td className="data-td" style={{ color: 'var(--accent)', fontWeight: 'var(--weight-semibold)' }}>
                  {Number(t.patients || 0).toLocaleString()}
                </td>
                <td className="data-td">
                  <Badge s={t.status} />
                </td>
                <td
                  className="data-td"
                  style={{
                    color: t.uptime === '—' ? 'var(--text-muted)' : 'var(--urgency-ok)',
                    fontWeight: 'var(--weight-semibold)',
                  }}
                >
                  {t.uptime}
                </td>
                <td className="data-td" style={{ color: 'var(--text-muted)' }}>
                  {t.created_at?.slice(0, 10)}
                </td>
                <td className="data-td">
                  <GhostBtn className="btn-sm" onClick={() => enterClinic(t.id)} disabled={entering === t.id}>
                    {entering === t.id ? 'A entrar…' : 'Entrar'}
                  </GhostBtn>
                </td>
              </tr>
            ))}
          />
        )}
      </div>
      {modal && (
        <Modal title="Nova clínica" onClose={() => setModal(false)}>
          <FormField label="Nome da clínica">
            <Inp
              placeholder="Clínica Dentária do Porto"
              value={form.name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </FormField>
          <FormField label="Cidade, país">
            <Inp
              placeholder="Porto, Portugal"
              value={form.city}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, city: e.target.value }))}
            />
          </FormField>
          <FormField label="Gabinetes">
            <Sel
              value={String(form.operatories)}
              onChange={(e) => setForm((p) => ({ ...p, operatories: Number(e.target.value) }))}
            >
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </Sel>
          </FormField>
          {erro ? <ErrorText>{erro}</ErrorText> : null}
          <div className="flex gap-3 mt-2">
            <PrimaryBtn onClick={provision} disabled={saving || !form.name}>
              {saving ? 'A criar…' : 'Criar clínica'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
