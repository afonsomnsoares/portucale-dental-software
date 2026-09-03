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

  useEffect(() => {
    api('/tenants')
      .then(setTenants)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [api]);

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
        title="Tenant Provisioning Engine"
        sub="Manage and provision clinic environments globally"
        action="+ Provision Clinic"
        onAction={() => setModal(true)}
      />
      <div style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ maxWidth: 300 }}
          placeholder="Search clinics or cities…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Spinner />
        ) : (
          <DataTable
            cols={['Clinic', 'City', 'Patients', 'Status', 'Uptime', 'Created', '']}
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
                  <GhostBtn className="btn-sm">View</GhostBtn>
                </td>
              </tr>
            ))}
          />
        )}
      </div>
      {modal && (
        <Modal title="Provision New Clinic" onClose={() => setModal(false)}>
          <FormField label="Clinic Name">
            <Inp
              placeholder="Manhattan Smile Center"
              value={form.name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </FormField>
          <FormField label="City, Country">
            <Inp
              placeholder="New York, USA"
              value={form.city}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, city: e.target.value }))}
            />
          </FormField>
          <FormField label="Operatories (Dentist Rooms)">
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
              {saving ? 'Provisioning…' : 'Provision Clinic'}
            </PrimaryBtn>
            <GhostBtn onClick={() => setModal(false)}>Cancel</GhostBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
