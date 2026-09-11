'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import {
  Badge,
  DangerBtn,
  DataTable,
  Empty,
  ErrorState,
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
import { useQuery } from '@/hooks/useQuery';
import type { DbUser, StaffShift, StaffTimeOff } from '@/lib/types';

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
  pending: { label: 'Pendente', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  approved: { label: 'Aprovado', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  rejected: { label: 'Rejeitado', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  cancelled: { label: 'Cancelado', bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' },
};

// Equipa da própria clínica. A versão de plataforma
// (components/super-admin/pages/Team.tsx) precisa de escolher a clínica no separador Férias
// e de reencaminhar o tenant do utilizador escolhido nas chamadas de horários; aqui
// /api/users, /api/staff-schedules e /api/staff-time-off já estão todos confinados a
// user.tenantId, por isso nada disso é preciso.
export default function ClinicTeamPage() {
  const { api } = useAuth();
  const [tab, setTab] = useState('schedules');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ weekday: '1', startTime: '09:00', endTime: '18:00' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const usersQuery = useQuery<DbUser[]>('/users');
  const users = usersQuery.data ?? [];

  // A primeira pessoa da lista fica escolhida assim que a lista chega. Tem de ser
  // um efeito e não o valor inicial do useState porque a lista só existe depois
  // da resposta — e não se sobrepõe a uma escolha já feita.
  useEffect(() => {
    if (!selectedUserId && users.length) setSelectedUserId(users[0].id);
  }, [users, selectedUserId]);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  // `null` enquanto ninguém estiver escolhido: o hook espera em vez de pedir os
  // turnos de um userId vazio.
  const shiftsQuery = useQuery<StaffShift[]>(selectedUserId ? `/staff-schedules?userId=${selectedUserId}` : null);
  const shifts = shiftsQuery.data ?? [];

  const timeOffParams = new URLSearchParams();
  if (statusFilter !== 'all') timeOffParams.set('status', statusFilter);
  const timeOffQs = timeOffParams.toString();
  const timeOffQuery = useQuery<StaffTimeOff[]>(`/staff-time-off${timeOffQs ? `?${timeOffQs}` : ''}`);
  const timeOff = timeOffQuery.data ?? [];

  const loadShifts = shiftsQuery.refetch;
  const loadTimeOff = timeOffQuery.refetch;

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
    setError('');
    try {
      await api(`/staff-schedules/${id}`, { method: 'DELETE' });
      loadShifts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível remover o turno.');
    }
    setBusyId(null);
  }

  async function setTimeOffStatus(id: string, status: 'approved' | 'rejected') {
    setBusyId(id);
    setError('');
    try {
      await api(`/staff-time-off/${id}`, { method: 'PUT', body: { status } });
      loadTimeOff();
    } catch (e) {
      // Aprovar ou recusar férias falhava em silêncio: a linha ficava em
      // 'pendente' e quem carregou não sabia se tinha sido ignorado.
      setError(e instanceof Error ? e.message : 'Não foi possível decidir este pedido.');
    }
    setBusyId(null);
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

      {usersQuery.error ? (
        <ErrorState error={usersQuery.error} onRetry={usersQuery.refetch} message="Não foi possível ler a equipa." />
      ) : usersQuery.loading ? (
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
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      —
                    </div>
                  ) : (
                    dayShifts.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between mb-2"
                        style={{
                          background: 'var(--accent-bg)',
                          color: 'var(--accent)',
                          borderRadius: 'var(--radius-control)',
                          padding: '4px 8px',
                          fontSize: 'var(--text-xs)',
                          fontWeight: 'var(--weight-semibold)',
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
                              style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}
                            >
                              Aprovar
                            </GhostBtn>
                            <DangerBtn
                              disabled={busyId === t.id}
                              onClick={() => setTimeOffStatus(t.id, 'rejected')}
                              style={{ padding: '5px 10px', fontSize: 'var(--text-xs)' }}
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
          <div className="grid-pair" style={{ gap: 12 }}>
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
          {error && (
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--urgency-critical)',
                fontWeight: 'var(--weight-bold)',
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
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
