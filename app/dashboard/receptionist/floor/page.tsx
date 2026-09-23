'use client';
import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import OperatoryPanel from '@/components/receptionist/OperatoryPanel';
import WaitingRoomPanel from '@/components/receptionist/WaitingRoomPanel';
import {
  clinicaMono,
  FormField,
  GhostBtn,
  Inp,
  Metric,
  MetricStrip,
  Modal,
  PageChrome,
  PrimaryBtn,
  SecondaryBtn,
  Spinner,
  Triage,
  TriageRow,
  WorkSection,
} from '@/components/ui';
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

  // ─── O atraso é o que a receção precisa de ver primeiro ───────────────────
  // Não há hora de chegada gravada em `appointments` — só a hora MARCADA. Dá na
  // mesma para a pergunta que interessa ao balcão: quem já devia ter entrado e
  // continua sentado. A partir de cinco minutos conta como atraso; abaixo disso
  // é o normal de uma clínica a funcionar, e uma fila que acende por dois
  // minutos deixa de se ler ao fim de um dia.
  const atrasadas = waiting
    .map((a) => ({ apt: a, atraso: nowMins - toMins(a.start_time) }))
    .filter((x) => x.atraso >= 5)
    .sort((a, b) => b.atraso - a.atraso);

  const emCadeira = todays.filter((a) => ['in-operatory', 'procedure-active'].includes(a.status)).length;

  if (apptsQuery.loading) return <Spinner />;

  return (
    <div>
      <PageChrome
        title="Sala de Espera"
        context={[clinicaMono(user?.tenantName || user?.clinic), syncedLabel && `sync ${syncedLabel}`]
          .filter(Boolean)
          .join(' · ')}
      >
        <span className="live" data-on={isConnected ? 'true' : 'false'} title={liveLabel}>
          {isConnected ? 'em direto' : 'sondagem 10s'}
        </span>
        <GhostBtn onClick={load} style={{ padding: '4px 10px' }}>
          Atualizar
        </GhostBtn>
      </PageChrome>

      <Triage title="À espera há mais tempo do que devia">
        {atrasadas.map(({ apt, atraso }) => (
          <TriageRow key={apt.id} when={`+${atraso}m`}>
            {apt.patient_name} — marcada para as {String(apt.start_time).slice(0, 5)}, ainda não entrou
          </TriageRow>
        ))}
      </Triage>

      <MetricStrip>
        <Metric
          label="a_espera"
          value={waiting.length}
          sub="sentados na sala"
          urgency={atrasadas.length > 0 ? 'soon' : undefined}
        />
        <Metric label="em_cadeira" value={emCadeira} sub={`de ${chairs.length} gabinetes`} />
        <Metric
          label="atrasadas"
          value={atrasadas.length}
          sub="passaram da hora marcada"
          urgency={atrasadas.length > 0 ? 'critical' : undefined}
        />
        <Metric label="ativas_hoje" value={active.length} sub="ainda por concluir" />
      </MetricStrip>

      <WorkSection title="Gabinetes" count={`${emCadeira} de ${chairs.length} ocupados`}>
        <OperatoryPanel
          chairs={chairs}
          todays={todays}
          nowMins={nowMins}
          statusTransitions={STATUS_TRANSITIONS}
          updatingId={updatingId}
          onSetStatus={setStatus}
        />
      </WorkSection>

      <WorkSection title="Sala de espera" count={`${waiting.length} doentes`}>
        <WaitingRoomPanel waiting={waiting} />
      </WorkSection>

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
