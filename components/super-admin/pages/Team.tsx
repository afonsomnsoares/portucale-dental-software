'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  Badge,
  DangerBtn,
  DataTable,
  Empty,
  FormField,
  GhostBtn,
  Modal,
  PageHeader,
  PrimaryBtn,
  Sel,
  Spinner,
  Tabs,
  TD,
} from '@/components/ui';
import type { DbUser, StaffShift, StaffTimeOff, Tenant } from '@/lib/types';

const WEEKDAYS = [
  { key: 1, label: 'Segunda' },
  { key: 2, label: 'Terça' },
  { key: 3, label: 'Quarta' },
  { key: 4, label: 'Quinta' },
  { key: 5, label: 'Sexta' },
  { key: 6, label: 'Sábado' },
  { key: 0, label: 'Domingo' },
];

const TYPE_LABEL: Record<string, string> = { vacation: 'Férias', sick: 'Baixa', other: 'Outro' };
const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: 'Pendente', bg: 'var(--amber-bg)', color: 'var(--amber)' },
  approved: { label: 'Aprovado', bg: 'var(--green-bg)', color: 'var(--green)' },
  rejected: { label: 'Rejeitado', bg: 'var(--red-bg)', color: 'var(--red)' },
  cancelled: { label: 'Cancelado', bg: 'var(--surface-2)', color: 'var(--ink-2)' },
};

export default function AdminTeamPage() {
  const { api, user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const [tab, setTab] = useState('schedules');
  const [users, setUsers] = useState<DbUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [timeOffTenantId, setTimeOffTenantId] = useState('');
  const [shifts, setShifts] = useState<StaffShift[]>([]);
  const [timeOff, setTimeOff] = useState<StaffTimeOff[]>([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ weekday: '1', startTime: '09:00', endTime: '18:00' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    // /api/users already spans every tenant for a super_admin (with tenant_name on each
    // row) — picking a user here also implicitly picks which tenant their shifts belong
    // to, so there's no need for a separate tenant picker on the Horários tab.
    api('/users')
      .then((rows) => {
        setUsers(rows || []);
        if ((rows || []).length) setSelectedUserId(rows[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    if (isSuperAdmin) {
      api('/tenants')
        .then((rows) => {
          setTenants(rows || []);
          if ((rows || []).length) setTimeOffTenantId(rows[0].id);
        })
        .catch(() => {});
    }
  }, [api, isSuperAdmin]);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  const loadShifts = useCallback(async () => {
    if (!selectedUserId) return;
    const qs = isSuperAdmin && selectedUser?.tenant_id ? `&tenantId=${selectedUser.tenant_id}` : '';
    const rows = await api(`/staff-schedules?userId=${selectedUserId}${qs}`).catch(() => []);
    setShifts(rows || []);
  }, [api, selectedUserId, isSuperAdmin, selectedUser]);

  const loadTimeOff = useCallback(async () => {
    if (isSuperAdmin && !timeOffTenantId) return;
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (isSuperAdmin) params.set('tenantId', timeOffTenantId);
    const qs = params.toString();
    const rows = await api(`/staff-time-off${qs ? `?${qs}` : ''}`).catch(() => []);
    setTimeOff(rows || []);
  }, [api, statusFilter, isSuperAdmin, timeOffTenantId]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);
  useEffect(() => {
    loadTimeOff();
  }, [loadTimeOff]);

  async function createShift() {
    setSaving(true);
    setError('');
    try {
      await api('/staff-schedules', {
        method: 'POST',
        body: {
          userId: selectedUserId,
          weekday: Number(form.weekday),
          startTime: form.startTime,
          endTime: form.endTime,
          ...(isSuperAdmin && selectedUser?.tenant_id ? { tenantId: selectedUser.tenant_id } : {}),
        },
      });
      setModal(false);
      loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar turno.');
    } finally {
      setSaving(false);
    }
  }

  async function removeShift(id: string) {
    setBusyId(id);
    await api(`/staff-schedules/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusyId(null);
    loadShifts();
  }

  async function setTimeOffStatus(id: string, status: 'approved' | 'rejected') {
    setBusyId(id);
    await api(`/staff-time-off/${id}`, { method: 'PUT', body: { status } }).catch(() => null);
    setBusyId(null);
    loadTimeOff();
  }

  return (
    <div>
      <PageHeader title="Equipa" sub="Horários semanais, disponibilidade e pedidos de férias" />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'schedules', label: 'Horários' },
          { key: 'timeoff', label: 'Férias' },
        ]}
      />

      {loading ? (
        <Spinner />
      ) : tab === 'schedules' ? (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <Sel value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} style={{ minWidth: 260 }}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </Sel>
            <PrimaryBtn onClick={() => setModal(true)} disabled={!selectedUserId}>
              + Adicionar turno
            </PrimaryBtn>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 12 }}>
            {WEEKDAYS.map((wd) => {
              const dayShifts = shifts.filter((s) => s.weekday === wd.key);
              return (
                <div key={wd.key} className="card p-3">
                  <div className="section-label mb-2">{wd.label}</div>
                  {!dayShifts.length ? (
                    <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
                      —
                    </div>
                  ) : (
                    dayShifts.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between mb-2"
                        style={{
                          background: 'var(--brand-bg)',
                          color: 'var(--brand)',
                          borderRadius: 6,
                          padding: '4px 8px',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        <span>
                          {s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeShift(s.id)}
                          disabled={busyId === s.id}
                          aria-label="Remover turno"
                          style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-3 mb-4">
            {isSuperAdmin && (
              <Sel
                value={timeOffTenantId}
                onChange={(e) => setTimeOffTenantId(e.target.value)}
                style={{ maxWidth: 260 }}
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Sel>
            )}
            <Sel value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ maxWidth: 220 }}>
              <option value="all">Todos os estados</option>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovados</option>
              <option value="rejected">Rejeitados</option>
              <option value="cancelled">Cancelados</option>
            </Sel>
          </div>
          {!timeOff.length ? (
            <Empty message="Sem pedidos de férias/ausência." />
          ) : (
            <div className="card" style={{ padding: 0 }}>
              <DataTable
                cols={['Membro da equipa', 'Tipo', 'Datas', 'Notas', 'Estado', '']}
                rows={timeOff.map((t) => {
                  const meta = STATUS_META[t.status];
                  return (
                    <tr key={t.id}>
                      <TD bold>{t.user_name}</TD>
                      <TD>{TYPE_LABEL[t.type]}</TD>
                      <TD>
                        {t.start_date.slice(0, 10)} → {t.end_date.slice(0, 10)}
                      </TD>
                      <TD muted>{t.notes || '—'}</TD>
                      <TD>
                        <Badge label={meta.label} bg={meta.bg} color={meta.color} />
                      </TD>
                      <TD right>
                        {t.status === 'pending' && (
                          <div className="flex items-center justify-end gap-2">
                            <GhostBtn
                              disabled={busyId === t.id}
                              onClick={() => setTimeOffStatus(t.id, 'approved')}
                              style={{ padding: '5px 10px', fontSize: 12 }}
                            >
                              Aprovar
                            </GhostBtn>
                            <DangerBtn
                              disabled={busyId === t.id}
                              onClick={() => setTimeOffStatus(t.id, 'rejected')}
                              style={{ padding: '5px 10px', fontSize: 12 }}
                            >
                              Rejeitar
                            </DangerBtn>
                          </div>
                        )}
                      </TD>
                    </tr>
                  );
                })}
              />
            </div>
          )}
        </div>
      )}

      {modal && (
        <Modal title={`Novo turno — ${selectedUser?.name || ''}`} onClose={() => setModal(false)}>
          <FormField label="Dia da semana">
            <Sel value={form.weekday} onChange={(e) => setForm((f) => ({ ...f, weekday: e.target.value }))}>
              {WEEKDAYS.map((wd) => (
                <option key={wd.key} value={wd.key}>
                  {wd.label}
                </option>
              ))}
            </Sel>
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Início">
              <input
                type="time"
                className="input"
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
              />
            </FormField>
            <FormField label="Fim">
              <input
                type="time"
                className="input"
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
              />
            </FormField>
          </div>
          {error && <div style={{ fontSize: 12, color: '#DE350B', fontWeight: 700, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={createShift} disabled={saving}>
              {saving ? 'A criar…' : 'Criar turno'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
