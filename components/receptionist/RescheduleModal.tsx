'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, GhostBtn, Modal, PrimaryBtn, Spinner } from '@/components/ui';
import type { Appointment } from '@/lib/types';

// ─── Remarcar ───────────────────────────────────────────────────────────────
// O gesto que faltava. Remarcar existia como três coisas separadas — cancelar, procurar
// um buraco na agenda a olho, editar a data — e a do meio era feita de cabeça, com o
// doente ao telefone. O motor de sugestões já sabia responder (especialidade do dentista,
// cadeira livre, equipamento exigido pelo tipo de tratamento) e nunca era chamado neste
// momento, que é aquele em que a resposta faz falta.
//
// Deliberadamente não há campo de data livre aqui: as alternativas vêm todas do servidor,
// já validadas. Um campo livre convida a escrever uma hora que parece livre e não está —
// e era exatamente assim que a edição à mão duplicava consultas.

interface Slot {
  date: string;
  startTime: string;
  chair: number;
  dentistId: string;
  dentistName: string;
  matchesPreferences: boolean;
  preferenceViolations: string[];
}

interface Suggestions {
  current: { date: string; startTime: string; duration: number; type: string };
  duration: number;
  slots: Slot[];
  warnings?: string[];
}

function diaLegivel(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  });
}

export default function RescheduleModal({
  appointment,
  onClose,
  onDone,
}: {
  appointment: Appointment;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api } = useAuth();
  const [data, setData] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(true);
  const [qualquerDentista, setQualquerDentista] = useState(false);
  const [aGravar, setAGravar] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro('');
    try {
      const params = new URLSearchParams({ days: '21' });
      if (qualquerDentista) params.set('anyDentist', '1');
      setData(await api(`/appointments/${appointment.id}/reschedule?${params.toString()}`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao procurar alternativas.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [api, appointment.id, qualquerDentista]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function mover(slot: Slot) {
    setAGravar(`${slot.date}|${slot.startTime}`);
    setErro('');
    try {
      await api(`/appointments/${appointment.id}/reschedule`, {
        method: 'POST',
        body: {
          date: slot.date,
          startTime: slot.startTime,
          chair: slot.chair,
          dentistId: slot.dentistId,
        },
      });
      onDone();
      onClose();
    } catch (e) {
      // 409 quando o lugar foi ocupado entre a sugestão e o clique. Recarregar em vez de
      // deixar a lista antiga no ecrã: insistir no mesmo botão daria o mesmo erro.
      setErro(e instanceof Error ? e.message : 'Não foi possível remarcar.');
      carregar();
    } finally {
      setAGravar(null);
    }
  }

  return (
    <Modal onClose={onClose} width={600} title={`Remarcar — ${appointment.patient_name || ''}`}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Atualmente:{' '}
          <b>
            {diaLegivel(String(appointment.appt_date).slice(0, 10))} às {String(appointment.start_time).slice(0, 5)}
          </b>{' '}
          · {appointment.type}
        </div>
        <label
          style={{
            display: 'flex',
            gap: 7,
            alignItems: 'center',
            marginTop: 9,
            fontSize: 'var(--text-2xs)',
            color: 'var(--text-muted)',
          }}
        >
          <input type="checkbox" checked={qualquerDentista} onChange={(e) => setQualquerDentista(e.target.checked)} />
          Aceitar qualquer dentista com a especialidade necessária
        </label>
      </div>

      {erro && (
        <div
          style={{
            border: '1px solid var(--urgency-critical-border)',
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            borderRadius: 'var(--radius-card)',
            padding: '9px 12px',
            fontSize: 'var(--text-xs)',
            marginBottom: 12,
          }}
        >
          {erro}
        </div>
      )}

      {data?.warnings?.map((w) => (
        <div key={w} style={{ fontSize: 'var(--text-2xs)', color: 'var(--urgency-soon)', marginBottom: 8 }}>
          {w}
        </div>
      ))}

      {loading ? (
        <Spinner />
      ) : !data?.slots.length ? (
        <Empty message="Sem horários compatíveis nos próximos 21 dias. Tenta aceitar outro dentista, ou põe o doente em lista de espera." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: '22rem', overflowY: 'auto' }}>
          {data.slots.map((s) => {
            const chave = `${s.date}|${s.startTime}`;
            return (
              <div
                key={chave}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-card)',
                  padding: '9px 12px',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
                    {diaLegivel(s.date)} às {s.startTime}
                  </div>
                  <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
                    {s.dentistName} · cadeira {s.chair}
                    {/* As preferências do doente nunca eliminam um horário — só o põem
                        mais abaixo. Dizer quais é que este viola evita telefonar a
                        propor exatamente o que ele já tinha dito que não podia. */}
                    {s.preferenceViolations?.length ? ` · contra: ${s.preferenceViolations.join(', ')}` : ''}
                  </div>
                </div>
                <PrimaryBtn onClick={() => mover(s)} disabled={aGravar !== null} style={{ whiteSpace: 'nowrap' }}>
                  {aGravar === chave ? 'A mover…' : 'Remarcar'}
                </PrimaryBtn>
              </div>
            );
          })}
        </div>
      )}

      {/* Dito porque a receção precisa de saber o que acontece a seguir ao clique: não
          tem de telefonar a confirmar a mudança — a mensagem sai sozinha, e tem
          prioridade sobre tudo o resto (ver CORRECTIVE_KINDS em coordinationCalc.ts). */}
      <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 12 }}>
        O doente recebe aviso da nova data na próxima passagem das tarefas, se tiver consentido contacto automático.
      </p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <GhostBtn onClick={onClose}>Fechar</GhostBtn>
      </div>
    </Modal>
  );
}
