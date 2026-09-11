'use client';
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import OperatoryPanel from '@/components/receptionist/OperatoryPanel';
import WaitingRoomPanel from '@/components/receptionist/WaitingRoomPanel';
import { FormField, GhostBtn, Inp, Modal, PageHeader, PrimaryBtn, SecondaryBtn, Spinner } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import { useSSE } from '@/hooks/useSSE';
import type { Appointment } from '@/lib/types';

function toMins(t = '00:00') {
  const p = String(t).slice(0, 5).split(':');
  return (+p[0] || 0) * 60 + (+p[1] || 0);
}

export default function LiveFloorPage() {
  const { api, settings, user } = useAuth();
  const apptsQuery = useQuery<Appointment[]>('/appointments');
  const appts = apptsQuery.data ?? [];
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const [closing, setClosing] = useState<{ apt: Appointment; amount: string; error: string } | null>(null);

  const load = useCallback(() => {
    apptsQuery.refetch();
    setSyncedAt(new Date());
  }, [apptsQuery]);

  // ─── Tempo real ─────────────────────────────────────────────────────────
  // Esta página recarregava a agenda inteira de 5 em 5 segundos. Numa receção com
  // quatro ecrãs abertos são 2 880 pedidos por hora para descobrir, quase sempre, que
  // nada mudou — e mesmo assim com até 5 segundos de atraso quando alguma coisa muda
  // mesmo. O canal SSE existia desde há muito e não tinha um único consumidor.
  //
  // Agora recarrega quando o Postgres avisa que uma consulta mudou (migração 051 →
  // lib/realtime.ts → app/api/sse/route.ts). O evento traz só a tabela e o id, de
  // propósito: quem quer os dados vai buscá-los pela API normal, com a sessão e a RLS
  // a valer.
  const onRealtimeChange = useCallback(() => {
    load();
  }, [load]);
  const { isConnected } = useSSE({ url: '/api/sse', tables: ['appointments'], onChange: onRealtimeChange });

  // A sondagem não desaparece — passa a rede de segurança. Sem ligação de tempo real
  // (proxy que corta streams, portátil que adormeceu, endpoint em baixo) a página tem
  // de continuar a funcionar, só que menos depressa. Com ligação, um minuto chega para
  // apanhar um evento que se tenha perdido entre reconexões.
  useEffect(() => {
    const id = setInterval(() => load(), isConnected ? 60000 : 10000);
    return () => clearInterval(id);
  }, [load, isConnected]);

  // Fechar a consulta é o momento em que a receção sabe quanto se cobrou — por isso o
  // valor pede-se aqui, e não numa secção de faturas à parte onde alguém se teria de
  // lembrar de ir a seguir. Ver app/api/appointments/[id]/status/route.ts: o valor entra
  // na mesma transação que o fecho, para não haver consulta fechada com valor perdido.
  async function setStatus(apt: Appointment, nextStatus: string) {
    if (nextStatus === 'departed') {
      setClosing({ apt, amount: '', error: '' });
      return;
    }
    await sendStatus(apt, nextStatus);
  }

  async function sendStatus(apt: Appointment, nextStatus: string, amount?: string) {
    setUpdatingId(apt.id);
    try {
      const body: { status: string; amount?: string } = { status: nextStatus };
      if (amount) body.amount = amount;
      await api(`/appointments/${apt.id}/status`, { method: 'PUT', body });
      apptsQuery.refetch();
      return true;
    } catch (e) {
      setClosing((c) => (c ? { ...c, error: e instanceof Error ? e.message : 'Não foi possível guardar.' } : c));
      return false;
    } finally {
      setUpdatingId(null);
    }
  }

  async function confirmClose(withAmount: boolean) {
    if (!closing) return;
    // O valor é opcional: nem toda a consulta cobra (seguimento incluído, comparticipação).
    const ok = await sendStatus(closing.apt, 'departed', withAmount ? closing.amount : undefined);
    if (ok) setClosing(null);
  }

  const STATUS_TRANSITIONS = settings?.STATUS_TRANSITIONS || {};
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const syncedLabel = syncedAt ? syncedAt.toTimeString().slice(0, 5) : '';
  // Dizer à pessoa se está a ver dados vivos ou dados de há um minuto. Sem isto, uma
  // ligação em baixo é indistinguível de uma clínica parada.
  const liveLabel = isConnected ? 'em direto' : 'a atualizar de 10 em 10s';

  const todays = useMemo(() => {
    return (appts || []).slice().sort((a, b) => toMins(a.start_time) - toMins(b.start_time));
  }, [appts]);

  const active = useMemo(() => {
    return todays.filter((a) => !['departed', 'no-show'].includes(a.status));
  }, [todays]);

  const waiting = useMemo(() => {
    return todays.filter((a) => ['registered', 'waiting'].includes(a.status));
  }, [todays]);

  const chairs = useMemo(() => {
    const n = Math.max(1, Number(user?.operatories || 3));
    return Array.from({ length: n }, (_, i) => i + 1);
  }, [user?.operatories]);

  if (apptsQuery.loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Sala em tempo real"
        sub={`${active.length} consulta${active.length !== 1 ? 's' : ''} ativa${active.length !== 1 ? 's' : ''} · ${new Date().toLocaleDateString('pt-PT', { weekday: 'long', month: 'short', day: 'numeric' })}${syncedLabel ? ` · sincronizado ${syncedLabel} (${liveLabel})` : ''}`}
      >
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <OperatoryPanel
            chairs={chairs}
            todays={todays}
            nowMins={nowMins}
            statusTransitions={STATUS_TRANSITIONS}
            updatingId={updatingId}
            onSetStatus={setStatus}
          />
          <WaitingRoomPanel waiting={waiting} />
        </div>
      </div>

      {closing && (
        <Modal title={`Fim da consulta — ${closing.apt.patient_name || 'paciente'}`} onClose={() => setClosing(null)}>
          <FormField
            label="Valor da consulta"
            hint="Deixa vazio se não houve cobrança. Isto regista o valor na conta corrente do doente — a fatura legal é emitida no software certificado da clínica."
          >
            <Inp
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              autoFocus
              placeholder="0,00 €"
              value={closing.amount}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setClosing((c) => (c ? { ...c, amount: e.target.value, error: '' } : c))
              }
            />
          </FormField>

          {closing.error && (
            <div
              className="text-sm"
              style={{ color: 'var(--urgency-critical)', fontWeight: 'var(--weight-bold)', marginTop: 12 }}
            >
              {closing.error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <SecondaryBtn onClick={() => confirmClose(false)} disabled={updatingId === closing.apt.id}>
              Sem cobrança
            </SecondaryBtn>
            <PrimaryBtn
              onClick={() => confirmClose(true)}
              disabled={updatingId === closing.apt.id || !closing.amount.trim()}
            >
              {updatingId === closing.apt.id ? 'A guardar...' : 'Registar e fechar'}
            </PrimaryBtn>
          </div>
        </Modal>
      )}
    </div>
  );
}
