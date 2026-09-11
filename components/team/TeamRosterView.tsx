'use client';
import { type ChangeEvent, useCallback, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import ShiftHandoffPanel from '@/components/team/ShiftHandoffPanel';
import {
  AlertBanner,
  Badge,
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
  Textarea,
} from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { StaffTimeOff, StaffTimeOffType, TeamRosterEntry } from '@/lib/types';

interface TeamRosterViewProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  // Necessário para a passagem de turno saber o que é "meu" — quem escreveu uma
  // passagem não a pode confirmar a si próprio (ver ShiftHandoffPanel).
  currentUserId?: string;
}

const TYPE_LABEL: Record<string, string> = { vacation: 'Férias', sick: 'Baixa', other: 'Outro' };
const STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: 'Pendente', bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  approved: { label: 'Aprovado', bg: 'var(--urgency-ok-bg)', color: 'var(--urgency-ok)' },
  rejected: { label: 'Rejeitado', bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  cancelled: { label: 'Cancelado', bg: 'var(--bg-sunken)', color: 'var(--text-secondary)' },
};

const EMPTY_FORM = { type: 'vacation' as StaffTimeOffType, startDate: '', endDate: '', notes: '' };

const COVERAGE_ROLE_LABEL: Record<string, string> = { dentist: 'dentista', receptionist: 'rececionista' };

export default function TeamRosterView({ api, currentUserId }: TeamRosterViewProps) {
  const [tab, setTab] = useState('today');
  const rosterQuery = useQuery<{ rows: TeamRosterEntry[]; coverageWarnings: string[] }>('/team-roster');
  const timeOffQuery = useQuery<StaffTimeOff[]>('/staff-time-off');
  const roster = rosterQuery.data?.rows ?? [];
  const coverageWarnings = rosterQuery.data?.coverageWarnings ?? [];
  const myRequests = timeOffQuery.data ?? [];
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    rosterQuery.refetch();
    timeOffQuery.refetch();
  }, [rosterQuery, timeOffQuery]);

  async function requestTimeOff() {
    if (!form.startDate || !form.endDate) return;
    setSaving(true);
    setError('');
    try {
      await api('/staff-time-off', { method: 'POST', body: form });
      setModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao pedir ausência.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelRequest(id: string) {
    setBusyId(id);
    setError('');
    try {
      await api(`/staff-time-off/${id}`, { method: 'PUT', body: { status: 'cancelled' } });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível cancelar o pedido.');
    }
    setBusyId(null);
  }

  if (rosterQuery.error)
    return <ErrorState error={rosterQuery.error} onRetry={load} message="Não foi possível ler a escala da equipa." />;
  if (rosterQuery.loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Equipa" sub="Quem está a trabalhar hoje, férias/ausências e passagem de turno">
        {tab === 'today' && <PrimaryBtn onClick={() => setModal(true)}>+ Pedir férias/ausência</PrimaryBtn>}
      </PageHeader>

      <Tabs
        tabs={[
          { key: 'today', label: 'Hoje' },
          { key: 'handoffs', label: 'Passagem de turno' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'handoffs' && <ShiftHandoffPanel api={api} currentUserId={currentUserId} />}

      {tab === 'today' && coverageWarnings.length > 0 && (
        <AlertBanner type="danger">
          {coverageWarnings.map((role) => `Sem ${COVERAGE_ROLE_LABEL[role] || role} escalado hoje`).join(' · ')}
        </AlertBanner>
      )}

      {tab === 'today' && (
        <div className="card p-5 mb-5">
          <div className="section-label mb-3">HOJE</div>
          {!roster.length ? (
            <Empty message="Sem membros de equipa ativos." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {roster.map((r) => (
                <div
                  key={r.userId}
                  className="flex items-center justify-between"
                  style={{
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-control)',
                    padding: '8px 12px',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{r.userName}</span>
                    <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                      {r.role}
                    </span>
                    {r.todayShifts.length > 0 && (
                      <span className="text-xs ml-2" style={{ color: 'var(--text-secondary)' }}>
                        {r.todayShifts.map((s) => `${s.startTime}-${s.endTime}`).join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.onLeaveToday && (
                      <Badge label="Em férias" bg="var(--urgency-soon-bg)" color="var(--urgency-soon)" />
                    )}
                    {r.workingNow && (
                      <Badge label="A trabalhar agora" bg="var(--urgency-ok-bg)" color="var(--urgency-ok)" />
                    )}
                    {!r.onLeaveToday && !r.todayShifts.length && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        Sem turno hoje
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'today' && (
        <div className="card p-5">
          <div className="section-label mb-3">AS MINHAS FÉRIAS E AUSÊNCIAS</div>
          {!myRequests.length ? (
            <Empty message="Sem pedidos feitos." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {myRequests.map((t) => {
                const meta = STATUS_META[t.status];
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between"
                    style={{
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-control)',
                      padding: '8px 12px',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{TYPE_LABEL[t.type]}</span>
                      <span className="text-xs ml-2" style={{ color: 'var(--text-secondary)' }}>
                        {t.start_date.slice(0, 10)} → {t.end_date.slice(0, 10)}
                      </span>
                      {t.notes && (
                        <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                          {t.notes}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge label={meta.label} bg={meta.bg} color={meta.color} />
                      {t.status === 'pending' && (
                        <GhostBtn
                          disabled={busyId === t.id}
                          onClick={() => cancelRequest(t.id)}
                          style={{ padding: '4px 10px', fontSize: 12 }}
                        >
                          Cancelar
                        </GhostBtn>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {modal && (
        <Modal title="Pedir férias/ausência" onClose={() => setModal(false)}>
          <FormField label="Tipo">
            <Sel
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as StaffTimeOffType }))}
            >
              <option value="vacation">Férias</option>
              <option value="sick">Baixa</option>
              <option value="other">Outro</option>
            </Sel>
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Data de início">
              <input
                type="date"
                className="input"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </FormField>
            <FormField label="Data de fim">
              <input
                type="date"
                className="input"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Notas (opcional)">
            <Textarea
              value={form.notes}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm((f) => ({ ...f, notes: e.target.value }))}
              style={{ minHeight: 60 }}
            />
          </FormField>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--urgency-critical)', fontWeight: 700, marginBottom: 10 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setModal(false)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={requestTimeOff} disabled={saving || !form.startDate || !form.endDate}>
              {saving ? 'A pedir…' : 'Pedir'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
