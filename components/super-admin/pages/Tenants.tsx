'use client';
import { type ChangeEvent, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  Badge,
  DataTable,
  FormField,
  GhostBtn,
  Inp,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
} from '@/components/ui';
import type { Tenant } from '@/lib/types';

export default function TenantsPage() {
  const { api } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', city: '', operatories: 3 });
  const [saving, setSaving] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);

  useEffect(() => {
    api('/tenants')
      .then(setTenants)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

  // Entrar na clínica: grava a clínica ativa (POST /api/tenants/enter) e leva às páginas
  // do admin. Recarrega a página em vez de navegar, para que /api/auth/me seja lido de novo
  // e o âmbito da sessão (faixa, sidebar, permissões) venha já com a clínica.
  async function enterClinic(id: string) {
    setEntering(id);
    const ok = await api('/tenants/enter', { method: 'POST', body: { tenantId: id } }).catch(() => null);
    if (ok) window.location.href = '/dashboard/admin';
    else setEntering(null);
  }

  async function provision() {
    setSaving(true);
    const t = await api('/tenants', { method: 'POST', body: form }).catch(() => null);
    if (t) {
      setTenants((p) => [...p, t]);
      setModal(false);
      setForm({ name: '', city: '', operatories: 3 });
    }
    setSaving(false);
  }

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
        {loading ? (
          <Spinner />
        ) : (
          <DataTable
            cols={['Clínica', 'Cidade', 'Doentes', 'Estado', 'Disponibilidade', 'Criada', '']}
            rows={filtered.map((t) => (
              <tr key={t.id}>
                <td className="data-td" style={{ fontWeight: 600 }}>
                  {t.name}
                </td>
                <td className="data-td" style={{ color: '#5E6C84' }}>
                  {t.city}
                </td>
                <td className="data-td" style={{ color: '#0052CC', fontWeight: 600 }}>
                  {Number(t.patients || 0).toLocaleString()}
                </td>
                <td className="data-td">
                  <Badge s={t.status} />
                </td>
                <td className="data-td" style={{ color: t.uptime === '—' ? '#97A0AF' : '#00875A', fontWeight: 600 }}>
                  {t.uptime}
                </td>
                <td className="data-td" style={{ color: '#97A0AF' }}>
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
