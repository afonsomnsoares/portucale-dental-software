'use client';
import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import {
  AlertBanner,
  Badge,
  Empty,
  FormField,
  GhostBtn,
  Modal,
  PrimaryBtn,
  Sel,
  Spinner,
  Textarea,
} from '@/components/ui';
import type { ShiftHandoff, ShiftHandoffDraft, ShiftLabel, TeamRosterEntry } from '@/lib/types';

interface ShiftHandoffPanelProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  currentUserId?: string;
}

const SHIFT_LABEL: Record<ShiftLabel, string> = {
  morning: 'Manhã',
  afternoon: 'Tarde',
  evening: 'Noite',
  other: 'Outro',
};

export default function ShiftHandoffPanel({ api, currentUserId }: ShiftHandoffPanelProps) {
  const [handoffs, setHandoffs] = useState<ShiftHandoff[]>([]);
  const [colleagues, setColleagues] = useState<TeamRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState(false);
  const [draft, setDraft] = useState<ShiftHandoffDraft | null>(null);
  const [items, setItems] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [notes, setNotes] = useState('');
  const [shiftLabel, setShiftLabel] = useState<ShiftLabel>('other');
  const [toUserId, setToUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    // /team-roster, não /users: este último exige 'users:manage' (só admin), e quem
    // faz turnos — rececionista e dentista — ficaria sem lista de colegas nenhuma.
    // O roster já é exatamente "quem trabalha nesta clínica" e está aberto a toda a
    // equipa (ver app/api/team-roster/route.ts).
    const [rows, roster] = await Promise.all([
      api('/shift-handoffs').catch(() => []),
      api('/team-roster').catch(() => null),
    ]);
    setHandoffs(rows || []);
    setColleagues((roster?.rows || []).filter((u: TeamRosterEntry) => u.userId !== currentUserId));
    setLoading(false);
  }, [api, currentUserId]);

  useEffect(() => {
    load();
  }, [load]);

  async function openComposer() {
    setError('');
    setBusy(true);
    const d = await api('/shift-handoffs/draft').catch(() => null);
    setBusy(false);
    if (!d) {
      setError('Não foi possível preparar o rascunho.');
      return;
    }
    setDraft(d);
    setItems(d.items || []);
    setShiftLabel(d.shiftLabel || 'other');
    setExtra('');
    setNotes('');
    setToUserId('');
    setComposer(true);
  }

  async function submit() {
    const finalItems = [
      ...items,
      ...extra
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    ];
    if (!finalItems.length && !notes.trim()) {
      setError('Escreve pelo menos um ponto ou uma nota.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/shift-handoffs', {
        method: 'POST',
        body: {
          handoffDate: draft?.date,
          shiftLabel,
          toUserId: toUserId || null,
          notes,
          items: finalItems,
        },
      });
      setComposer(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gravar a passagem.');
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(id: string) {
    setBusy(true);
    setError('');
    try {
      await api(`/shift-handoffs/${id}`, { method: 'PUT', body: {} });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao confirmar.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  const openForMe = handoffs.filter(
    (h) => h.status === 'open' && h.from_user_id !== currentUserId && (!h.to_user_id || h.to_user_id === currentUserId),
  );

  return (
    <div>
      {error && <AlertBanner type="danger">{error}</AlertBanner>}

      {openForMe.length > 0 && (
        <AlertBanner type="warning">
          {openForMe.length} passagem(ns) de turno por confirmar dirigida(s) a ti.
        </AlertBanner>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <PrimaryBtn onClick={openComposer} disabled={busy}>
          + Deixar passagem de turno
        </PrimaryBtn>
      </div>

      {!handoffs.length ? (
        <Empty message="Sem passagens de turno registadas." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {handoffs.map((h) => {
            // Quem escreve não confirma a própria passagem — a confirmação existe
            // para provar que o turno seguinte leu (ver lib/shiftHandoff.ts).
            const canAcknowledge =
              h.status === 'open' &&
              h.from_user_id !== currentUserId &&
              (!h.to_user_id || h.to_user_id === currentUserId);
            return (
              <div key={h.id} className="card" style={{ padding: 14 }}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{h.from_user_name}</span>
                    <span className="text-xs ml-2" style={{ color: 'var(--ink-2)' }}>
                      {String(h.handoff_date).slice(0, 10)} · {SHIFT_LABEL[h.shift_label]} →{' '}
                      {h.to_user_name || 'turno seguinte'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {h.status === 'acknowledged' ? (
                      <Badge
                        label={`Confirmado por ${h.acknowledged_by_name || '—'}`}
                        bg="var(--green-bg)"
                        color="var(--green)"
                      />
                    ) : (
                      <Badge label="Por confirmar" bg="var(--amber-bg)" color="var(--amber)" />
                    )}
                    {canAcknowledge && (
                      <GhostBtn
                        onClick={() => acknowledge(h.id)}
                        disabled={busy}
                        style={{ padding: '4px 10px', fontSize: 12 }}
                      >
                        Confirmar leitura
                      </GhostBtn>
                    )}
                  </div>
                </div>
                {h.items?.length > 0 && (
                  <ul style={{ margin: '0 0 6px 16px', padding: 0, fontSize: 12, color: 'var(--ink-2)' }}>
                    {h.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                )}
                {h.notes && (
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{h.notes}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {composer && (
        <Modal title="Passagem de turno" onClose={() => setComposer(false)} width={640}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Turno">
              <Sel value={shiftLabel} onChange={(e) => setShiftLabel(e.target.value as ShiftLabel)}>
                {Object.entries(SHIFT_LABEL).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Sel>
            </FormField>
            <FormField label="Para" hint="Deixa vazio para quem entrar a seguir.">
              <Sel value={toUserId} onChange={(e) => setToUserId(e.target.value)}>
                <option value="">Turno seguinte (qualquer pessoa)</option>
                {colleagues.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.userName}
                    {u.onLeaveToday ? ' (ausente hoje)' : u.todayShifts.length ? '' : ' (sem turno hoje)'}
                  </option>
                ))}
              </Sel>
            </FormField>
          </div>

          <div className="section-label mb-2">PENDENTES DETETADOS AUTOMATICAMENTE</div>
          {!items.length ? (
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
              Nada pendente detetado — a clínica está limpa.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {items.map((it) => (
                <label
                  key={it}
                  style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked
                    onChange={() => setItems((prev) => prev.filter((x) => x !== it))}
                    style={{ marginTop: 2 }}
                  />
                  <span>{it}</span>
                </label>
              ))}
            </div>
          )}

          <FormField label="Outros pontos (um por linha)">
            <Textarea
              value={extra}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setExtra(e.target.value)}
              style={{ minHeight: 70 }}
            />
          </FormField>
          <FormField label="Notas livres">
            <Textarea
              value={notes}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
              style={{ minHeight: 70 }}
            />
          </FormField>

          {error && <div style={{ fontSize: 12, color: '#DE350B', fontWeight: 700, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <GhostBtn onClick={() => setComposer(false)}>Cancelar</GhostBtn>
            <PrimaryBtn onClick={submit} disabled={busy}>
              {busy ? 'A gravar…' : 'Deixar passagem'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
