import { appendAudit } from './audit';
import type { SessionUser } from './auth';
import { query, queryOne } from './db';
import { normalizePolicy, type SchedulingPolicy } from './schedulingPolicyCalc';

// A metade da política que toca na base de dados (migração 046). As regras estão
// todas em lib/schedulingPolicyCalc.ts, puro e testado — mesma divisão de
// lib/schedulingPrefs.ts / lib/schedulingPrefsCalc.ts.

export async function getSchedulingPolicy(tenantId: string): Promise<SchedulingPolicy> {
  const row = await queryOne(`SELECT * FROM tenant_scheduling_policy WHERE tenant_id=$1`, [tenantId]);
  return normalizePolicy(row);
}

/**
 * Grava a política. Passa sempre por normalizePolicy antes de tocar na base:
 * os CHECK da migração recusariam um valor fora do intervalo com um erro de
 * Postgres em vez de uma mensagem legível, e um campo em falta no corpo do PUT
 * deve cair no valor por omissão e não em NULL.
 *
 * Mudar a autonomia de um agente que contacta doentes é um ato de gestão, por
 * isso fica no audit_log com o antes e o depois — é a pergunta que se faz
 * quando alguém estranha um SMS que a clínica mandou.
 */
export async function saveSchedulingPolicy(
  tenantId: string,
  user: SessionUser,
  input: Record<string, unknown>,
): Promise<SchedulingPolicy> {
  const previous = await getSchedulingPolicy(tenantId);
  const p = normalizePolicy({ ...previous, ...input });

  await query(
    `INSERT INTO tenant_scheduling_policy
       (tenant_id, mode, max_offers_per_slot, daily_contact_cap, quiet_hours_start, quiet_hours_end,
        min_score, allowed_sources, horizon_days, offer_expiry_hours, patient_cooldown_days, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9,$10,$11,$12)
     ON CONFLICT (tenant_id) DO UPDATE SET
       mode                  = EXCLUDED.mode,
       max_offers_per_slot   = EXCLUDED.max_offers_per_slot,
       daily_contact_cap     = EXCLUDED.daily_contact_cap,
       quiet_hours_start     = EXCLUDED.quiet_hours_start,
       quiet_hours_end       = EXCLUDED.quiet_hours_end,
       min_score             = EXCLUDED.min_score,
       allowed_sources       = EXCLUDED.allowed_sources,
       horizon_days          = EXCLUDED.horizon_days,
       offer_expiry_hours    = EXCLUDED.offer_expiry_hours,
       patient_cooldown_days = EXCLUDED.patient_cooldown_days,
       updated_by            = EXCLUDED.updated_by`,
    [
      tenantId,
      p.mode,
      p.maxOffersPerSlot,
      p.dailyContactCap,
      p.quietHoursStart,
      p.quietHoursEnd,
      p.minScore,
      p.allowedSources,
      p.horizonDays,
      p.offerExpiryHours,
      p.patientCooldownDays,
      user.id || null,
    ],
  );

  if (previous.mode !== p.mode) {
    await appendAudit(user, 'UPDATE', 'Autonomia do agente de agenda', previous.mode, p.mode, user.clinic);
  } else {
    await appendAudit(user, 'UPDATE', 'Política do agente de agenda', null, p.mode, user.clinic);
  }
  return p;
}

/**
 * Quantos contactos automáticos ainda cabem hoje. Conta as ofertas já enviadas
 * desde a meia-noite — e conta-as na tabela das ofertas, não na das
 * notificações, de propósito: uma oferta cuja SMS falhou no envio gastou na
 * mesma a decisão de contactar aquela pessoa, e voltar a tentar amanhã é
 * diferente de tentar outra vez já a seguir.
 */
export async function remainingContactBudget(tenantId: string, policy: SchedulingPolicy): Promise<number> {
  const row = await queryOne(
    `SELECT COUNT(*)::int AS n FROM slot_offers
      WHERE tenant_id=$1 AND created_at >= date_trunc('day', NOW())`,
    [tenantId],
  );
  return Math.max(0, policy.dailyContactCap - Number(row?.n || 0));
}
