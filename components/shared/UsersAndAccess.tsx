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
import { MIN_PASSWORD_LENGTH } from '@/lib/constants';
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

// ─── Um só ecrã de utilizadores, dois âmbitos ───────────────────────────────
// Eram duas cópias com 311 de 349 linhas iguais. Esta serve as duas porque já
// tinha, dentro dela, os dois casos: `isSuperAdmin` decide se há lista de
// clínicas, se aparece o campo "Clínica" no formulário, e se o papel de admin
// pode ser atribuído. A versão de clínica não fazia nada de diferente — fazia
// menos, e repetia as outras 311 linhas para o dizer.
//
// O servidor impõe tudo isto de qualquer forma: app/api/users/route.ts força o
// tenant de quem chama e só aceita role='admin' vindo de um super-admin. Isto
// aqui é a interface a não prometer o que não pode cumprir.
export default function UsersAndAccess() {
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

  // Ao editar, deixar a password vazia significa "manter a atual" — só se valida o que
  // foi de facto escrito. Ao criar, é obrigatória (o `required` do campo trata disso).
  const passwordTooShort = !!form.password && form.password.length < MIN_PASSWORD_LENGTH;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Só o super-admin escolhe a clínica do utilizador (ver o campo mais abaixo) —
      // e GET /api/tenants é restrito a super_admin do lado do servidor, por isso um
      // admin de clínica a pedi-la levaria apenas um 403.
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
    // O servidor recusa abaixo de MIN_PASSWORD_LENGTH (app/api/users/route.ts). Sem esta
    // guarda o formulário deixava submeter e a pessoa só descobria no 400 de volta.
    if (passwordTooShort) return;

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
    super_admin: 'var(--urgency-critical)',
    admin: 'var(--cat-purple)',
    receptionist: 'var(--urgency-ok)',
    dentist: 'var(--accent)',
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
        title="Utilizadores"
        sub="Equipa — contas, funções e acesso"
        action="+ Novo Utilizador"
        onAction={openCreate}
      />

      <div style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <Inp
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          placeholder="Procurar por nome, email, função, clínica…"
          style={{ maxWidth: 420 }}
        />
        {search && (
          <GhostBtn onClick={() => setSearch('')} style={{ padding: '8px 12px' }}>
            Limpar
          </GhostBtn>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
          {filtered.length} / {users.length}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <Spinner />
        ) : (
          <DataTable
            cols={['Nome', 'Email', 'Função', 'Clínica', 'Estado', '']}
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
                      borderRadius: 'var(--radius-card)',
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
                    Editar
                  </GhostBtn>
                </TD>
              </tr>
            ))}
          />
        )}
      </div>

      {modal && (
        <Modal title={editingId ? 'Editar utilizador' : 'Novo utilizador'} onClose={() => setModal(false)} width={420}>
          <form onSubmit={save}>
            <FormField label="Nome completo *">
              <Inp
                value={form.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </FormField>

            <FormField label="Email *">
              <Inp
                type="email"
                value={form.email}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </FormField>

            <FormField
              label={editingId ? 'Nova palavra-passe (deixar vazio para manter)' : 'Palavra-passe *'}
              hint={
                passwordTooShort
                  ? `Mínimo ${MIN_PASSWORD_LENGTH} caracteres (tens ${form.password.length})`
                  : `Mínimo ${MIN_PASSWORD_LENGTH} caracteres`
              }
            >
              <Inp
                type="password"
                value={form.password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))}
                required={!editingId}
                placeholder={editingId ? '••••••••' : ''}
              />
            </FormField>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Função *">
                {form.role === 'super_admin' ? (
                  // O único super-admin da plataforma — nunca criado nem alterado por este
                  // formulário (ver app/api/users/[id]/route.ts). Só aqui chega quando é
                  // ele próprio a editar o seu perfil.
                  <Sel value="super_admin" disabled>
                    <option value="super_admin">Super Admin</option>
                  </Sel>
                ) : isSuperAdmin ? (
                  // Só um super-admin concede ou retira o estatuto de admin de clínica — ver
                  // app/api/users/route.ts e app/api/users/[id]/route.ts.
                  <Sel value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                    <option value="receptionist">Rececionista</option>
                    <option value="dentist">Dentista</option>
                    <option value="admin">Admin</option>
                  </Sel>
                ) : editingId && form.role === 'admin' ? (
                  // Um admin de clínica vê a função de um colega admin mas não a pode
                  // retirar — só o super-admin revoga esse estatuto.
                  <Sel value="admin" disabled>
                    <option value="admin">Admin</option>
                  </Sel>
                ) : (
                  <Sel value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                    <option value="receptionist">Rececionista</option>
                    <option value="dentist">Dentista</option>
                  </Sel>
                )}
              </FormField>

              <FormField label="Nome da clínica">
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
              <FormField label="Especialidades (separadas por vírgula — ex.: Ortodontia, Implantologia)">
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
              <FormField label="Clínica *">
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
              <FormField label="Estado">
                <Sel
                  value={form.active ? 'true' : 'false'}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === 'true' }))}
                >
                  <option value="true">Active (Can Login)</option>
                  <option value="false">Suspended (Blocked)</option>
                </Sel>
              </FormField>
            )}

            {err && (
              <div style={{ color: 'var(--urgency-critical)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
                {err}
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <PrimaryBtn
                type="submit"
                disabled={
                  saving ||
                  !form.name ||
                  !form.email ||
                  (!editingId && !form.password) ||
                  passwordTooShort ||
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
