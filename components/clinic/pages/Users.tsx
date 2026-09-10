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
import type { DbUser } from '@/lib/types';

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

// Utilizadores da própria clínica. Face à versão de plataforma
// (components/super-admin/pages/Users.tsx) desaparecem três coisas que só o super_admin
// tem: a lista de tenants, o campo "Tenant" no formulário e a possibilidade de atribuir
// o papel de admin. O backend já impõe tudo isto (app/api/users/route.ts força o tenant
// de quem chama e só aceita 'admin' de um super_admin) — aqui é a UI a deixar de
// prometer o que não pode cumprir.
export default function ClinicUsersPage() {
  const { api } = useAuth();
  const [users, setUsers] = useState<DbUser[]>([]);
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
      const u = await api('/users');
      setUsers(u || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [api]);

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
      tenantId: '',
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
        sub="Equipa desta clínica — contas, funções e acesso"
        action="+ Novo Utilizador"
        onAction={openCreate}
      />

      <div style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <Inp
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          placeholder="Procurar por nome, email, função…"
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
                {editingId && form.role === 'admin' ? (
                  // Um admin de clínica vê a função de um colega admin mas não a pode
                  // retirar — só o super_admin revoga o estatuto de admin (ver
                  // app/api/users/[id]/route.ts).
                  <Sel value="admin" disabled>
                    <option value="admin">Administrador</option>
                  </Sel>
                ) : (
                  <Sel value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                    <option value="receptionist">Rececionista</option>
                    <option value="dentist">Médico Dentista</option>
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
              <FormField label="Especialidades (separadas por vírgula)">
                <Inp
                  value={form.specialties}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setForm((f) => ({ ...f, specialties: e.target.value }))
                  }
                  placeholder="Ortodontia, Implantologia, Reabilitação Oral"
                />
              </FormField>
            )}

            {editingId && (
              <FormField label="Estado">
                <Sel
                  value={form.active ? 'true' : 'false'}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.value === 'true' }))}
                >
                  <option value="true">Ativo (pode entrar)</option>
                  <option value="false">Suspenso (bloqueado)</option>
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
                disabled={saving || !form.name || !form.email || (!editingId && !form.password) || passwordTooShort}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {saving ? 'A guardar…' : editingId ? 'Guardar alterações' : 'Criar utilizador'}
              </PrimaryBtn>
              <GhostBtn type="button" onClick={() => setModal(false)}>
                Cancelar
              </GhostBtn>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
