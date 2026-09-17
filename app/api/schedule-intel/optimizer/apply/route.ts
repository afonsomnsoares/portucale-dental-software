import { appendAudit, appendTimeline } from '@/lib/audit';
import { queryOne, withTransaction } from '@/lib/db';
import { conflict } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { computeScheduleOptimization } from '@/lib/scheduleOptimizer';
import { claimSlot, SlotTakenError } from '@/lib/scheduling';

// ─── Aplicar uma proposta do otimizador ─────────────────────────────────────
// O otimizador era read-only por desenho, e a razão estava escrita no PRODUCT.md:
// «mover uma consulta obriga a avisar o doente». Esse aviso passou a existir — uma
// consulta que muda de lugar carimba `rescheduled_at` (migração 061) e a tarefa
// 'confirmations' avisa o doente na passagem seguinte, com prioridade acima de tudo o
// resto por ser uma correção (ver CORRECTIVE_KINDS em lib/agents/coordinationCalc.ts).
// Caída a razão, cai a restrição.
//
// O que NÃO cai é a fronteira dos agentes: isto não é um agente a arrumar a agenda
// sozinho. É uma pessoa a carregar num botão sobre uma proposta que já estava no ecrã —
// o mesmo desenho da oferta de lista de espera, em que a IA prepara e alguém confirma.
// Por isso vive numa rota com 'appointments:update' e não numa tarefa do cron.
//
// ─── O corpo traz a CHAVE, nunca o destino ─────────────────────────────────
// Aceitar {appointmentId, date, startTime} do cliente transformaria isto em «mover
// qualquer consulta para qualquer lado» com outro nome — uma segunda porta para a agenda,
// ao lado de /appointments/[id]/reschedule, com as suas próprias regras a divergir.
// Em vez disso o servidor recalcula a otimização e procura a proposta por `key`. Só
// aplica o destino que ele próprio apurou, agora.
//
// O efeito colateral é a garantia que interessa: se a agenda mudou desde que o ecrã foi
// desenhado, a proposta já não aparece no recálculo e a resposta é 409. Uma proposta
// obsoleta não se aplica por o botão ainda lá estar.
export const POST = withRoute(
  { permission: 'appointments:update', tenant: 'required' },
  async ({ request, user, tenantId }) => {
    const body = await request.json().catch(() => null);
    const key = String(body?.key || '');
    if (!key) return Response.json({ error: 'key é obrigatório' }, { status: 400 });

    const { moves } = await computeScheduleOptimization(tenantId);
    const move = moves.find((m) => m.key === key);
    if (!move) {
      return conflict('Esta proposta já não se aplica — a agenda mudou. Atualize a lista.');
    }
    if (!move.apply) {
      // As propostas sem destino não são um erro do cliente: são propostas cuja execução
      // é uma conversa (marcar gente da lista de espera, corrigir uma marcação que viola
      // as preferências do doente). Ver OptimizerApply em lib/scheduleOptimizerCalc.ts.
      return Response.json(
        { error: 'Esta proposta não se aplica automaticamente — é preciso decidir com o doente.' },
        { status: 422 },
      );
    }

    const alvo = move.apply;
    const prev = await queryOne(`SELECT * FROM appointments WHERE id=$1 AND tenant_id=$2`, [
      alvo.appointmentId,
      tenantId,
    ]);
    if (!prev) return Response.json({ error: 'Consulta não encontrada' }, { status: 404 });

    let updated: Record<string, unknown>;
    try {
      updated = await withTransaction(async (client) => {
        // A mesma reserva que criar, editar e remarcar usam. A proposta foi calculada
        // fora da transação, por isso o lugar pode ter sido ocupado entretanto — e é
        // aqui, com o lock tomado, que isso se descobre.
        await claimSlot(client, {
          tenantId,
          dentistId: alvo.dentistId,
          date: alvo.date,
          startTime: alvo.startTime,
          duration: Number(prev.duration) || 30,
          chair: alvo.chair,
          excludeAppointmentId: alvo.appointmentId,
        });

        const { rows } = await client.query(
          `UPDATE appointments
              SET appt_date=$1::date, start_time=$2::time, chair=$3, dentist_id=$4,
                  rescheduled_at = CASE WHEN $5 THEN NOW() ELSE rescheduled_at END
            WHERE id=$6 AND tenant_id=$7
            RETURNING *`,
          [alvo.date, alvo.startTime, alvo.chair, alvo.dentistId, alvo.notifiesPatient, alvo.appointmentId, tenantId],
        );
        return rows[0];
      });
    } catch (e) {
      if (e instanceof SlotTakenError) {
        return conflict('Esse lugar acabou de ser ocupado. Atualize a lista de propostas.');
      }
      throw e;
    }

    const antes = `${String(prev.appt_date).slice(0, 10)} ${String(prev.start_time).slice(0, 5)} · cadeira ${prev.chair}`;
    const depois = `${alvo.date} ${alvo.startTime} · cadeira ${alvo.chair}`;
    // O registo diz que veio do otimizador e qual foi a regra. Sem isso, a auditoria
    // mostra uma consulta movida sem se saber se foi alguém a decidir ou uma proposta
    // aceite — e é precisamente a distinção que justifica esta rota existir.
    await appendAudit(user, 'UPDATE', `Otimizador aplicado (${move.kind})`, antes, depois, user.clinic);
    if (updated.patient_id && alvo.notifiesPatient) {
      await appendTimeline(
        String(updated.patient_id),
        user,
        'admin',
        `Consulta remarcada pelo otimizador: ${antes} → ${depois}`,
      );
    }

    return Response.json({
      applied: { key: move.key, kind: move.kind },
      from: antes,
      to: depois,
      // Quem aplicou precisa de saber se o doente vai ser avisado ou se tem de telefonar.
      patientWillBeNotified: alvo.notifiesPatient,
    });
  },
);
