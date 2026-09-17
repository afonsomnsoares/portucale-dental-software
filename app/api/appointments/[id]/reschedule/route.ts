import { appendAudit, appendTimeline } from '@/lib/audit';
import { queryOne, withTransaction } from '@/lib/db';
import { conflict } from '@/lib/http';
import { withRoute } from '@/lib/route';
import { claimSlot, SlotTakenError, suggestAppointmentSlots } from '@/lib/scheduling';
import { getOwnedUser } from '@/lib/tenantGuard';
import { asDate } from '@/lib/validate';

// ─── Remarcar ───────────────────────────────────────────────────────────────
// Remarcar existia como três coisas separadas que ninguém tinha juntado: cancelar
// (DELETE), procurar alternativas (/appointments/suggest) e editar a data à mão (PUT).
// Na prática a receção fazia a do meio de cabeça — abria a agenda, procurava um buraco a
// olho, e editava. As alternativas que o motor já sabia calcular (especialidade do
// dentista, cadeira livre, equipamento exigido pelo tipo de tratamento) não chegavam a
// este momento, que é exatamente aquele em que fazem falta.
//
// GET devolve as alternativas para ESTA consulta — herda o tipo, a duração e o dentista
// dela, para quem está ao telefone não ter de os voltar a escrever.
// POST move-a para a alternativa escolhida.
//
// Uma nota sobre o que isto NÃO é: não cancela e volta a marcar. É a mesma linha que muda
// de sítio, e de propósito — cancelar libertaria a vaga para a lista de espera
// (notifyWaitlistOfFreedSlot no DELETE), e oferecer a três pessoas o lugar de um doente
// que está ao telefone a tentar ficar com outro é uma corrida que a clínica perde das duas
// maneiras. O histórico da mudança fica na timeline do doente e em rescheduled_at.

export const GET = withRoute<{ id: string }>(
  { permission: 'appointments:update', tenant: 'required' },
  async ({ request, params, tenantId }) => {
    const { id } = params;
    const apt = await queryOne(`SELECT * FROM appointments WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!apt) return Response.json({ error: 'Not found' }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const from = asDate(searchParams.get('from')) || new Date().toLocaleDateString('en-CA');
    const daysRaw = Number(searchParams.get('days') || 14);
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(60, Math.floor(daysRaw))) : 14;
    // Mais do que o DEFAULT_SUGGEST_LIMIT (5) do motor, de propósito. Cinco chegam para
    // propor uma primeira marcação a quem não tem restrição nenhuma; quem está a
    // remarcar já tinha um lugar e perdeu-o por alguma razão — «nessa semana não posso»,
    // «de manhã não dá» — e as cinco primeiras são todas do mesmo início de agenda.
    const limitRaw = Number(searchParams.get('limit') || 12);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, Math.floor(limitRaw))) : 12;

    const suggestions = await suggestAppointmentSlots({
      tenantId,
      type: String(apt.type),
      duration: Number(apt.duration) || 30,
      // O dentista atual é uma preferência e não uma exigência: se quem remarca for
      // indiferente, ?anyDentist=1 abre a procura aos outros com a especialidade certa.
      preferredDentistId:
        searchParams.get('anyDentist') === '1' ? undefined : ((apt.dentist_id as string | null) ?? undefined),
      patientId: (apt.patient_id as string | null) ?? undefined,
      fromDate: from,
      days,
      limit,
      // A consulta que se está a mover não pode bloquear as alternativas mais próximas
      // dela — ver excludeAppointmentId em lib/scheduling.ts.
      excludeAppointmentId: String(apt.id),
    });

    return Response.json({
      current: {
        id: String(apt.id),
        date: String(apt.appt_date).slice(0, 10),
        startTime: String(apt.start_time).slice(0, 5),
        duration: Number(apt.duration),
        chair: Number(apt.chair),
        type: String(apt.type),
        dentistId: apt.dentist_id,
      },
      ...suggestions,
    });
  },
);

export const POST = withRoute<{ id: string }>(
  { permission: 'appointments:update', tenant: 'required' },
  async ({ request, user, params, tenantId }) => {
    const { id } = params;
    const body = await request.json().catch(() => null);
    if (!body) return Response.json({ error: 'Corpo inválido' }, { status: 400 });

    const prev = await queryOne(`SELECT * FROM appointments WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    if (!prev) return Response.json({ error: 'Not found' }, { status: 404 });

    // Uma consulta que já aconteceu (ou faltou) não se remarca — marca-se outra. Deixar
    // mover um 'departed' reescreveria a história clínica administrativa da clínica.
    if (!['confirmed', 'waiting'].includes(String(prev.status))) {
      return Response.json(
        { error: `Só se remarca uma consulta por realizar (estado atual: ${prev.status}).` },
        { status: 409 },
      );
    }

    const date = asDate(body.date);
    const startTime = String(body.startTime || '');
    if (!date || !/^\d{2}:\d{2}(:\d{2})?$/.test(startTime)) {
      return Response.json({ error: 'date (YYYY-MM-DD) e startTime (HH:MM) são obrigatórios' }, { status: 400 });
    }

    const dentistId = body.dentistId ?? prev.dentist_id;
    if (dentistId) {
      const d = await getOwnedUser(dentistId, { tenantId }, { role: 'dentist', activeOnly: true });
      if (!d) return Response.json({ error: 'Invalid dentist' }, { status: 400 });
    }
    const chair = Math.max(1, Number(body.chair ?? prev.chair ?? 1));
    const duration = Math.max(5, Number(body.duration ?? prev.duration ?? 30));

    let updated: Record<string, unknown>;
    try {
      updated = await withTransaction(async (client) => {
        // Lock e verificação partilhados com o criar e o editar — ver claimSlot em
        // lib/scheduling.ts. Eram três cópias, e a do editar não existia.
        await claimSlot(client, {
          tenantId,
          dentistId,
          date,
          startTime,
          duration,
          chair,
          excludeAppointmentId: id,
        });

        const { rows } = await client.query(
          `UPDATE appointments
              SET appt_date=$1::date, start_time=$2::time, duration=$3, chair=$4, dentist_id=$5,
                  rescheduled_at=NOW()
            WHERE id=$6 AND tenant_id=$7
            RETURNING *`,
          [date, startTime, duration, chair, dentistId, id, tenantId],
        );
        return rows[0];
      });
    } catch (e) {
      if (e instanceof SlotTakenError) {
        return conflict('Esse horário acabou de ser ocupado — escolha outro.');
      }
      throw e;
    }

    const antes = `${String(prev.appt_date).slice(0, 10)} ${String(prev.start_time).slice(0, 5)}`;
    const depois = `${String(updated.appt_date).slice(0, 10)} ${String(updated.start_time).slice(0, 5)}`;
    await appendAudit(user, 'UPDATE', `Appointment rescheduled`, antes, depois, user.clinic);
    if (updated.patient_id) {
      await appendTimeline(String(updated.patient_id), user, 'admin', `Consulta remarcada: ${antes} → ${depois}`);
    }

    // A mensagem ao doente não sai daqui: sai da tarefa 'confirmations', que passou a
    // varrer também por rescheduled_at. É a mesma razão pela qual a confirmação de uma
    // marcação nova também não sai da rota — tudo o que fala com um doente passa pelo
    // árbitro (lib/agents/coordination.ts), e o árbitro corre por passagem.
    const full = await queryOne(
      `SELECT a.*, p.name as patient_name, d.name as dentist_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN users d ON d.id = a.dentist_id
        WHERE a.id=$1`,
      [updated.id],
    );
    return Response.json({ appointment: full || updated, from: antes, to: depois });
  },
);
