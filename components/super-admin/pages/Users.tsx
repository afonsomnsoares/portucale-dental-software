'use client';
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from 'react';
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
  TD,
} from '@/components/ui';
import type { DbUser, Tenant } from '@/lib/types';

interface UserForm {
  name: string;
  email: string;
  password: string;
  role: string;
  clinic: string;
  tenantId: string;
  active: boolean;
  specialties: string;
}

export default function AdminUsersPage() {
  const { api, user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [users, setUsers] = useState<DbUser[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [form, setForm] = useState<UserForm>({
    name: '',
    email: '',
    password: '',
    role: 'receptionist',
    clinic: 'Main',
    tenantId: '',
    active: true,
    specialties: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Only the super_admin may pick a tenant for the user being created/edited (see the
      // Tenant field below) — GET /api/tenants is restricted to super_admin server-side
      // too, so a clinic admin fetching it would just 403.
      const [u, t] = await Promise.all([api('/users'), isSuperAdmin ? api('/tenants') : Promise.resolve([])]);
      setUsers(u || []);
      setTenants(t || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [api, isSuperAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm({
      name: '',
      email: '',
      password: '',
      role: 'receptionist',
      clinic: 'Main',
      tenantId: tenants[0]?.id || '',
      active: true,
      specialties: '',
    });
    setErr('');
    setModal(true);
  }

  function openEdit(u: DbUser) {
    setEditingId(u.id);
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      clinic: u.clinic,
      tenantId: u.tenant_id || '',
      active: u.active,
      specialties: (u.specialties || []).join(', '),
    });
    setErr('');
    setModal(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email || (!editingId && !form.password)) return;

    setSaving(true);
    setErr('');
    try {
      const specialties = form.specialties
        .split(',')
        .map((s) => s.trim())
        .filter((s) => !!s);
      const body = { ...form, specialties };
      if (editingId) {
        const u = await api(`/users/${editingId}`, { method: 'PUT', body });
        setUsers(users.map((x) => (x.id === editingId ? u : x)));
      } else {
        const u = await api('/users', { method: 'POST', body });
        setUsers([u, ...users]);
      }
      setModal(false);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to save user.');
    } finally {
      setSaving(false);
    }
  }

  const roleColors: Record<string, string> = {
    super_admin: '#DE350B',
    admin: '#5243AA',
    receptionist: '#00875A',
    dentist: '#0052CC',
  };
  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(u.name || '')
        .toLowerCase()
        .includes(q) ||
      String(u.email || '')
        .toLowerCase()
        .includes(q) ||
      String(u.role || '')
        .toLowerCase()
        .includes(q) ||
      String(u.clinic || '')
        .toLowerCase()
        .includes(q) ||
      String(u.tenant_name || '')
        .toLowerCase()
        .includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="Users & Access"
        sub="Manage platform users, roles, and clinic assignments"
        action="+ Create User"
        onAction={openCreate}
      />

      <div style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <Inp
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          placeholder="Search users by name, email, role, clinic..."
          style={{ maxWidth: 420 }}
        />
        {search && (
          <GhostBtn onClick={() => setSearch('')} style={{ padding: '8px 12px' }}>
            Clear
          </GhostBtn>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#97A0AF', fontWeight: 700 }}>
          {filtered.length} / {users.length}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Spinner />
        ) : (
          <DataTable
            cols={['Name', 'Email', 'Role', 'Clinic / Tenant', 'Status', '']}
            rows={filtered.map((u) => (
              <tr key={u.id}>
                <TD bold>{u.name}</TD>
                <TD muted>{u.email}</TD>
                <TD>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 12,
                      background: `${roleColors[u.role]}15`,
                      color: roleColors[u.role],
                    }}
                  >
                    {u.role.toUpperCase()}
                  </span>
                </TD>
                <TD muted>
                  {u.clinic} {u.tenant_name ? `(${u.tenant_name})` : ''}
                </TD>
                <TD>
                  <Badge s={u.active ? 'active' : 'suspended'} />
                </TD>
                <TD right>
                  <GhostBtn onClick={() => openEdit(u)} style={{ padding: '6px 12px', fontSize: 12 }}>
                    Edit
                  </GhostBtn>
                </TD>
              </tr>
            ))}
          />
        )}
      </div>

      {modal && (
        <Modal title={editingId ? 'Edit User' : 'Create New User'} onClose={() => setModal(false)} width={420}>
          <form onSubmit={save}>
            <FormField label="Full Name *">
              <Inp
                value={form.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </FormField>

            <FormField label="Email Address *">
              <Inp
                type="email"
                value={form.email}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </FormField>

            <FormField label={editingId ? 'New Password (leave blank to keep current)' : 'Password *'}>
              <Inp
                type="password"
                value={form.password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))}
                required={!editingId}
                placeholder={editingId ? '••••••••' : ''}
              />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Role *">
                {form.role === 'super_admin' ? (
                  // The one platform super_admin — never created/changed through this form
                  // (see app/api/users/[id]/route.ts). Only reachable here at all when the
                  // viewer is that same super_admin editing their own profile.
                  <Sel value="super_admin" disabled>
                    <option value="super_admin">Super Admin</option>
                  </Sel>
                ) : isSuperAdmin ? (
                  // Only a super_admin may grant/revoke admin (clinic-admin) status — see
                  // app/api/users/route.ts and app/api/users/[id]/route.ts.
                  <Sel value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                    <option value="receptionist">Receptionist</option>
                    <option value="dentist">Dentist</option>
                    <option value="admin">Admin</option>
                  </Sel>
                ) : editingId && form.role === 'admin' ? (
                  // A clinic admin can see a peer admin's role but not change it away —
                  // only a super_admin can revoke admin status.
                  <Sel value="admin" disabled>
                    <option value="admin">Admin</option>
                  </Sel>
                ) : (
                  <Sel value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                    <option value="receptionist">Receptionist</option>
                    <option value="dentist">Dentist</option>
                  </Sel>
                )}
              </FormField>

              <FormField label="Clinic Name">
                <Inp
                  value={form.clinic}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, clinic: e.target.value }))}
                />
              </FormField>
            </div>

            {form.role === 'dentist' && (
              // Feeds lib/scheduling.ts's suggestAppointmentSlots (requiredSpecialty
              // matching — "encontrar dentista adequado") and lib/waitlist.ts's slot
              // matching. Comma-separated free text, same idiom as everything else in
              // this project that models a loose, clinic-defined vocabulary (appointment
              // types, treatment codes) rather than a fixed enum.
              <FormField label="Specialties (comma-separated, e.g. Ortodontia, Implantologia)">
                <Inp
                  value={form.specialties}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setForm((f) => ({ ...f, specialties: e.target.value }))
                  }
                  placeholder="Ortodontia, Implantologia, Reabilitação Oral"
                />
              </FormField>
            )}

            {isSuperAdmin && form.role !== 'super_admin' && (
              // A clinic admin never sees this — they can only ever create/edit users inside
              // their own tenant, which the backend applies automatically regardless of what's
              // submitted (see app/api/users/route.ts). Only the super_admin, who has no
              // tenant of their own, needs to pick one.
              <FormField label="Tenant *">
                <Sel
                  value={form.tenantId}
                  onChange={(e) => setForm((f) => ({ ...f, tenantId: e.target.value }))}
                  required
                >
                  <option value="">— Select a clinic —</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Sel>
              </FormField>
            )}

            {editingId && (
              <FormField label="Status">
                <Sel
                  value={form.active ? 'true' : 'false'}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === 'true' }))}
                >
                  <option value="true">Active (Can Login)</option>
                  <option value="false">Suspended (Blocked)</option>
                </Sel>
              </FormField>
            )}

            {err && <div style={{ color: '#DE350B', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{err}</div>}

            <div className="flex gap-3 mt-4">
              <PrimaryBtn
                type="submit"
                disabled={
                  saving ||
                  !form.name ||
                  !form.email ||
                  (!editingId && !form.password) ||
                  (isSuperAdmin && form.role !== 'super_admin' && !form.tenantId)
                }
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create User'}
              </PrimaryBtn>
              <GhostBtn type="button" onClick={() => setModal(false)}>
                Cancel
              </GhostBtn>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
