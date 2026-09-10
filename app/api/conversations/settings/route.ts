import { appendAudit } from '@/lib/audit';
import {
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
  AUTONOMY_NOTES,
  DEFAULT_AUTONOMY,
  isAutonomyLevel,
} from '@/lib/conversationCalc';
import { query, queryOne } from '@/lib/db';
import { withRoute } from '@/lib/route';

// O nível de autonomia: se a IA pode falar sozinha com um doente, e até onde.
//
// Escrever exige 'conversations:configure', que por omissão só a direção tem. Não é
// uma preferência de ecrã — é a decisão mais consequente que uma clínica toma nesta
// aplicação, e continua a ser uma decisão de pessoas.
//
// Duas coisas NÃO dependem deste campo, em nenhum degrau: um pedido para não ser
// contactado é sempre processado, e qualquer assunto clínico escala sempre para uma
// pessoa sem resposta automática. Ver lib/conversationCalc.ts.
export const GET = withRoute({ permission: 'conversations:read' }, async ({ tenantId }) => {
  const row = await queryOne(`SELECT * FROM tenant_comms_settings WHERE tenant_id=$1`, [tenantId]);
  return Response.json({
    settings: {
      autonomyLevel: isAutonomyLevel(row?.autonomy_level) ? row.autonomy_level : DEFAULT_AUTONOMY,
      openingHours: row?.opening_hours || '',
      addressText: row?.address_text || '',
      acknowledgement: row?.acknowledgement || '',
      quietHoursStart: row?.quiet_hours_start || '21:00',
      quietHoursEnd: row?.quiet_hours_end || '08:00',
    },
    levels: AUTONOMY_LEVELS.map((l) => ({ value: l, label: AUTONOMY_LABELS[l], note: AUTONOMY_NOTES[l] })),
  });
});

export const PUT = withRoute({ permission: 'conversations:configure' }, async ({ request, user, tenantId }) => {
  const body = await request.json().catch(() => null);
  if (!body) return Response.json({ error: 'Corpo inválido' }, { status: 400 });
  if (body.autonomyLevel !== undefined && !isAutonomyLevel(body.autonomyLevel)) {
    return Response.json({ error: `autonomyLevel tem de ser: ${AUTONOMY_LEVELS.join(', ')}` }, { status: 400 });
  }
  // Os degraus acima de 'acknowledge' respondem com texto que a clínica escreveu. Sem
  // esse texto, o degrau ficaria ligado e mudo — o que é pior do que estar desligado,
  // porque parece que está a funcionar.
  if (body.autonomyLevel === 'informational' || body.autonomyLevel === 'transactional') {
    if (!String(body.openingHours || '').trim() || !String(body.addressText || '').trim()) {
      return Response.json(
        { error: 'Para responder a factos é preciso preencher o horário e a morada — a IA não os inventa.' },
        { status: 400 },
      );
    }
  }

  const [row] = await query(
    `INSERT INTO tenant_comms_settings
       (tenant_id, autonomy_level, opening_hours, address_text, acknowledgement, quiet_hours_start, quiet_hours_end, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id) DO UPDATE SET
       autonomy_level = EXCLUDED.autonomy_level,
       opening_hours = EXCLUDED.opening_hours,
       address_text = EXCLUDED.address_text,
       acknowledgement = EXCLUDED.acknowledgement,
       quiet_hours_start = EXCLUDED.quiet_hours_start,
       quiet_hours_end = EXCLUDED.quiet_hours_end,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [
      tenantId,
      body.autonomyLevel || DEFAULT_AUTONOMY,
      body.openingHours || '',
      body.addressText || '',
      body.acknowledgement || 'Recebemos a sua mensagem. Respondemos assim que possível.',
      body.quietHoursStart || '21:00',
      body.quietHoursEnd || '08:00',
    ],
  );
  // Auditado sempre e por escrito: mudar quem fala com os doentes é exatamente o tipo
  // de decisão que alguém vai querer reconstituir mais tarde.
  await appendAudit(user, 'UPDATE', `Autonomia de comunicação → ${row?.autonomy_level}`, null, 'ok', user.clinic);
  return Response.json({ settings: row });
});
