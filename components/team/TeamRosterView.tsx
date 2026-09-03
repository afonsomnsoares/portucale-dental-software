'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import ShiftHandoffPanel from '@/components/team/ShiftHandoffPanel';
import {
  AlertBanner,
  Badge,
  Empty,
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
  pending: { label: 'Pendente', bg: 'var(--amber-bg)', color: 'var(--amber)' },
  approved: { label: 'Aprovado', bg: 'var(--green-bg)', color: 'var(--green)' },
  rejected: { label: 'Rejeitado', bg: 'var(--red-bg)', color: 'var(--red)' },
  cancelled: { label: 'Cancelado', bg: 'var(--surface-2)', color: 'var(--ink-2)' },
};

const EMPTY_FORM = { type: 'vacation' as StaffTimeOffType, startDate: '', endDate: '', notes: '' };

const COVERAGE_ROLE_LABEL: Record<string, string> = { dentist: 'dentista', receptionist: 'rececionista' };

export default function TeamRosterView({ api, currentUserId }: TeamRosterViewProps) {
  const [tab, setTab] = useState('today');
  const [roster, setRoster] = useState<TeamRosterEntry[]>([]);
  const [coverageWarnings, setCoverageWarnings] = useState<string[]>([]);
  const [myRequests, setMyRequests] = useState<StaffTimeOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, t] = await Promise.all([api('/team-roster').catch(() => null), api('/staff-time-off').catch(() => [])]);
    setRoster(r?.rows || []);
    setCoverageWarnings(r?.coverageWarnings || []);
    setMyRequests(t || []);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

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
    await api(`/staff-time-off/${id}`, { method: 'PUT', body: { status: 'cancelled' } }).catch(() => null);
    setBusyId(null);
    load();
  }

  if (loading) return <Spinner />;

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
                  style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{r.userName}</span>
                    <span className="text-xs ml-2" style={{ color: 'var(--ink-3)' }}>
                      {r.role}
                    </span>
                    {r.todayShifts.length > 0 && (
                      <span className="text-xs ml-2" style={{ color: 'var(--ink-2)' }}>
                        {r.todayShifts.map((s) => `${s.startTime}-${s.endTime}`).join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.onLeaveToday && <Badge label="Em férias" bg="var(--amber-bg)" color="var(--amber)" />}
                    {r.workingNow && <Badge label="A trabalhar agora" bg="var(--green-bg)" color="var(--green)" />}
                    {!r.onLeaveToday && !r.todayShifts.length && (
                      <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
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
                    style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}
                  >
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{TYPE_LABEL[t.type]}</span>
                      <span className="text-xs ml-2" style={{ color: 'var(--ink-2)' }}>
                        {t.start_date.slice(0, 10)} → {t.end_date.slice(0, 10)}
                      </span>
                      {t.notes && (
                        <span className="text-xs ml-2" style={{ color: 'var(--ink-3)' }}>
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
          {error && <div style={{ fontSize: 12, color: '#DE350B', fontWeight: 700, marginBottom: 10 }}>{error}</div>}
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
