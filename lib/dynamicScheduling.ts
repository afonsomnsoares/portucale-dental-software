import { dentistsForOpening, loadAgendaSnapshot } from './agendaOpenings';
import { chooseOffersToContact } from './agents/dynamicSchedulingAgent';
import { appendAudit } from './audit';
import type { SessionUser } from './auth';
import { queryOne } from './db';
import { buildDemandPool } from './demandPool';
import {
  applyContactLimits,
  type DemandSource,
  effectiveOpeningStart,
  type OpeningSlot,
  type PlannedOffer,
  planOffers,
  type SlotPlan,
  SOURCE_LABEL_PT,
} from './demandPoolCalc';
import { minutesToTime } from './scheduling';
import { getSchedulingPolicy, remainingContactBudget } from './schedulingPolicy';
import {
  offerExpiryAt,
  policyAutoBooks,
  policyComputes,
  policyContacts,
  policyIsQuietAt,
  type SchedulingPolicy,
} from './schedulingPolicyCalc';
import { createOffer } from './slotOffers';

// ─── Dynamic Scheduling ────────────────────────────────────────────────────
//
// A funcionalidade que inverte a pergunta da agenda.
//
// Até aqui o produto respondia à pergunta do doente — "quando quer marcar?"
// (lib/scheduling.ts) — e reagia a cancelamentos (lib/waitlist.ts). O que
// faltava era a pergunta da clínica, feita sobre a agenda que já existe:
//
//     "a cadeira 2 está livre amanhã às 14:30 durante 90 minutos.
//      De toda a gente que conheço, quem devia estar sentado nela?"
//
// O caminho é sempre o mesmo e cada troço vive no seu ficheiro:
//
//   1. onde há cadeira parada .................. lib/agendaOpenings.ts
//   2. quem tem motivo para vir ................ lib/demandPool.ts
//   3. quem cabe onde, e quanto vale ........... lib/demandPoolCalc.ts   (puro)
//   4. quais valem um contacto hoje ............ lib/agents/dynamicSchedulingAgent.ts
//   5. até onde a clínica autoriza ............. lib/schedulingPolicyCalc.ts (puro)
//   6. a oferta e a resposta ................... lib/slotOffers.ts + app/api/webhooks/sms
//
// Este ficheiro é o caminho, não as regras: tudo o que decide alguma coisa está
// num módulo puro e testado, ou na política que a clínica assinou.

// Um espaço com menos do que isto não serve para nenhum tratamento real (a
// consulta mais curta do catálogo são 15 minutos) — mesma constante e mesma
// razão do otimizador.
const MIN_USEFUL_OPENING_MINUTES = 30;

export interface PlanOfferView {
  candidateKey: string;
  source: DemandSource;
  sourceLabel: string;
  patientId: string;
  patientName: string;
  phone: string | null;
  canSms: boolean;
  treatmentType: string;
  durationMinutes: number;
  score: number;
  reason: string;
  valueEur: number;
  noShowRiskPct: number;
  dentistId: string | null;
  dentistName: string | null;
  startTime: string;
  preferenceViolations: string[];
  /** Antecipação: a consulta que esta oferta substituiria. */
  advanceFrom: { appointmentId: string; date: string } | null;
}

export interface PlanSlotView {
  key: string;
  chair: number;
  date: string;
  startTime: string;
  endTime: string;
  freeMinutes: number;
  kind: 'gap' | 'edge';
  agentNote?: string;
  offers: PlanOfferView[];
}

export interface WithheldView {
  patientName: string;
  sourceLabel: string;
  date: string;
  startTime: string;
  reason: string;
}

export interface DynamicPlan {
  generatedAt: string;
  policy: SchedulingPolicy;
  /** O que a política deixa fazer, em texto, para a página não repetir a lógica. */
  autonomy: { computes: boolean; contacts: boolean; autoBooks: boolean; quietNow: boolean };
  slots: PlanSlotView[];
  withheld: WithheldView[];
  counts: Record<DemandSource, number>;
  totals: {
    openings: number;
    candidates: number;
    plannedOffers: number;
    contactableOffers: number;
    fillableMinutes: number;
    estimatedValueEur: number;
  };
  remainingContactBudget: number;
  warnings: string[];
}

function toOpeningSlots(snapshot: Awaited<ReturnType<typeof loadAgendaSnapshot>>, now: Date): OpeningSlot[] {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const slots: OpeningSlot[] = [];
  for (const o of snapshot.openings) {
    // O que resta do espaço a partir de agora, com o aviso mínimo já
    // descontado. Os dentistas são calculados sobre o espaço encurtado — quem
    // está livre às 09:00 pode já não estar às 17:00.
    const start = effectiveOpeningStart(o, snapshot.today, nowMinutes, MIN_USEFUL_OPENING_MINUTES);
    if (start === null) continue;
    const trimmed = { ...o, startMinutes: start, durationMinutes: o.endMinutes - start };
    slots.push({
      key: `${o.date}|${o.chair}|${start}`,
      chair: o.chair,
      date: o.date,
      startMinutes: start,
      endMinutes: o.endMinutes,
      kind: o.kind,
      equipmentTags: [...new Set(snapshot.tagsByChair.get(o.chair) || [])],
      dentists: dentistsForOpening(snapshot, trimmed),
    });
  }
  return slots;
}

function toOfferView(offer: PlannedOffer): PlanOfferView {
  const c = offer.candidate;
  return {
    candidateKey: c.key,
    source: c.source,
    sourceLabel: SOURCE_LABEL_PT[c.source],
    patientId: c.patientId,
    patientName: c.patientName,
    phone: c.phone,
    canSms: c.canSms,
    treatmentType: c.treatmentType,
    durationMinutes: c.durationMinutes,
    score: offer.score,
    reason: offer.reason,
    valueEur: Math.round(c.valueEur),
    noShowRiskPct: Math.round(c.noShowRisk * 100),
    dentistId: offer.dentist?.dentistId || null,
    dentistName: offer.dentist?.dentistName || null,
    startTime: minutesToTime(offer.startMinutes),
    preferenceViolations: offer.preferenceViolations,
    advanceFrom:
      c.source === 'advance' && c.currentAppointmentId && c.currentAppointmentDate
        ? { appointmentId: c.currentAppointmentId, date: c.currentAppointmentDate }
        : null,
  };
}

const EMPTY_COUNTS: Record<DemandSource, number> = {
  waitlist: 0,
  treatment_open: 0,
  recall_due: 0,
  advance: 0,
  reactivation: 0,
};

/**
 * O plano de uma clínica onde não há nada a calcular. Existe para o caminho
 * curto: com a política em 'off' ou 'propose', a corrida automática não tem de
 * ler a agenda inteira nem construir a procura de nada — é trabalho de segundos
 * por clínica, a cada passagem do cron, para deitar fora no fim. O plano
 * completo continua a ser calculado por quem o pede (a página, via GET).
 */
function emptyPlan(policy: SchedulingPolicy, now: Date, warning: string): DynamicPlan {
  return {
    generatedAt: now.toISOString(),
    policy,
    autonomy: {
      computes: policyComputes(policy),
      contacts: policyContacts(policy),
      autoBooks: policyAutoBooks(policy),
      quietNow: policyIsQuietAt(policy, now),
    },
    slots: [],
    withheld: [],
    counts: { ...EMPTY_COUNTS },
    totals: {
      openings: 0,
      candidates: 0,
      plannedOffers: 0,
      contactableOffers: 0,
      fillableMinutes: 0,
      estimatedValueEur: 0,
    },
    remainingContactBudget: 0,
    warnings: [warning],
  };
}

interface ComputedPlan {
  plan: DynamicPlan;
  /** Os planos crus, para runDynamicScheduling não recalcular. */
  raw: SlotPlan[];
  contactable: SlotPlan[];
  policy: SchedulingPolicy;
}

async function computeInternal(tenantId: string, now = new Date()): Promise<ComputedPlan> {
  const policy = await getSchedulingPolicy(tenantId);
  const autonomy = {
    computes: policyComputes(policy),
    contacts: policyContacts(policy),
    autoBooks: policyAutoBooks(policy),
    quietNow: policyIsQuietAt(policy, now),
  };

  if (!autonomy.computes) {
    return {
      policy,
      raw: [],
      contactable: [],
      plan: emptyPlan(policy, now, 'O agente de agenda está desligado nesta clínica.'),
    };
  }

  const snapshot = await loadAgendaSnapshot(tenantId, policy.horizonDays, MIN_USEFUL_OPENING_MINUTES);
  const openings = toOpeningSlots(snapshot, now);
  const pool = await buildDemandPool(tenantId, { horizonDays: policy.horizonDays, sources: policy.allowedSources });
  const extraWarnings: string[] = [];

  // Um espaço sem dentista de turno não é um espaço: é uma cadeira num dia em
  // que ninguém trabalha. O motor rejeita-o (candidateFits), e bem — oferecer
  // uma consulta sem saber quem a faz manda o doente a uma clínica vazia.
  //
  // O problema é o silêncio: uma clínica que nunca preencheu os turnos da equipa
  // vê "0 encaixes" ao lado de "56 espaços livres" e conclui que a
  // funcionalidade não funciona. É um problema de configuração e tem de o dizer.
  if (openings.length && !openings.some((o) => o.dentists.length)) {
    extraWarnings.push(
      'Nenhum espaço livre tem dentista de turno — sem horários da equipa (Equipa › Horários) o agente não pode ' +
        'oferecer nada, porque não sabe quem atenderia.',
    );
  }

  const raw = planOffers(openings, pool.candidates, snapshot.today, {
    maxPerSlot: policy.maxOffersPerSlot,
    minScore: policy.minScore,
  });

  const budget = await remainingContactBudget(tenantId, policy);
  const { toContact, withheld } = applyContactLimits(raw, {
    now,
    cooldownDays: policy.patientCooldownDays,
    remainingToday: budget,
    allowedSources: policy.allowedSources,
  });

  const plannedOffers = raw.reduce((n, p) => n + p.offers.length, 0);
  const contactableOffers = toContact.reduce((n, p) => n + p.offers.length, 0);

  const slots: PlanSlotView[] = raw.map((p) => ({
    key: p.opening.key,
    chair: p.opening.chair,
    date: p.opening.date,
    startTime: minutesToTime(p.opening.startMinutes),
    endTime: minutesToTime(p.opening.endMinutes),
    freeMinutes: p.opening.endMinutes - p.opening.startMinutes,
    kind: p.opening.kind,
    offers: p.offers.map(toOfferView),
  }));

  return {
    policy,
    raw,
    contactable: toContact,
    plan: {
      generatedAt: now.toISOString(),
      policy,
      autonomy,
      slots,
      withheld: withheld.map((w) => ({
        patientName: w.offer.candidate.patientName,
        sourceLabel: SOURCE_LABEL_PT[w.offer.candidate.source],
        date: w.opening.date,
        startTime: minutesToTime(w.offer.startMinutes),
        reason: w.reason,
      })),
      counts: pool.counts,
      totals: {
        openings: openings.length,
        candidates: pool.candidates.length,
        plannedOffers,
        contactableOffers,
        // Só os minutos que as ofertas planeadas ocupam de facto — nunca o
        // tamanho dos buracos. Mesma disciplina do buildGapFillMoves: um espaço
        // de 3 horas com um candidato de 30 minutos recupera 30, não 180.
        fillableMinutes: raw.reduce((n, p) => n + p.offers.reduce((m, o) => m + o.candidate.durationMinutes, 0), 0),
        estimatedValueEur: Math.round(
          raw.reduce((n, p) => n + p.offers.reduce((m, o) => m + o.candidate.valueEur, 0), 0),
        ),
      },
      remainingContactBudget: budget,
      warnings: [...snapshot.warnings, ...extraWarnings, ...pool.warnings],
    },
  };
}

/** O plano, sem contactar ninguém. É o que a página mostra e o que a rota GET devolve. */
export async function computeDynamicPlan(tenantId: string): Promise<DynamicPlan> {
  const { plan } = await computeInternal(tenantId);
  return plan;
}

export interface DynamicRunResult {
  mode: SchedulingPolicy['mode'];
  decidedBy: 'ai' | 'deterministic' | 'none';
  offersSent: number;
  slotsTouched: number;
  skipped: string | null;
  plan: DynamicPlan;
}

function formatPtDate(date: string) {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Calcula e, se a política deixar, contacta.
 *
 * As três razões para não sair nada daqui são deliberadamente iguais em peso —
 * nenhuma delas é uma falha, todas são a política a funcionar:
 *   modo 'off'/'propose' ....... a clínica não autorizou contacto automático;
 *   horas de silêncio .......... não se manda SMS às 23h por causa de uma vaga;
 *   teto diário esgotado ....... já se contactou o que estava autorizado hoje.
 */
export async function runDynamicScheduling(
  tenantId: string,
  actor: Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'>,
  now = new Date(),
): Promise<DynamicRunResult> {
  // A política primeiro, e só depois o trabalho. Com o valor por omissão
  // ('propose') nada seria enviado — ler a agenda inteira e construir a procura
  // toda para deitar fora o resultado é trabalho que o cron faria por cada
  // clínica, a cada passagem, para nada.
  const policy = await getSchedulingPolicy(tenantId);
  if (!policyContacts(policy)) {
    const reason = policy.mode === 'off' ? 'agente desligado' : 'política em "só propor" — nada é contactado';
    return {
      mode: policy.mode,
      decidedBy: 'none',
      offersSent: 0,
      slotsTouched: 0,
      skipped: reason,
      plan: emptyPlan(policy, now, reason),
    };
  }
  if (policyIsQuietAt(policy, now)) {
    return {
      mode: policy.mode,
      decidedBy: 'none',
      offersSent: 0,
      slotsTouched: 0,
      skipped: 'horas de silêncio',
      plan: emptyPlan(policy, now, 'Horas de silêncio — nada é enviado agora.'),
    };
  }

  const { plan, contactable } = await computeInternal(tenantId, now);
  if (!contactable.length) {
    return {
      mode: policy.mode,
      decidedBy: 'none',
      offersSent: 0,
      slotsTouched: 0,
      skipped: plan.remainingContactBudget <= 0 ? 'teto diário de contactos atingido' : null,
      plan,
    };
  }

  const { plans: chosen, decidedBy, notes } = await chooseOffersToContact(contactable, policy.maxOffersPerSlot);
  const tenant = await queryOne(`SELECT name FROM tenants WHERE id=$1`, [tenantId]);
  const clinicName = String(tenant?.name || 'a clínica');
  const autoBook = policyAutoBooks(policy);

  let offersSent = 0;
  let slotsTouched = 0;

  for (const p of chosen) {
    let sentHere = 0;
    for (const offer of p.offers) {
      const c = offer.candidate;
      const startTime = minutesToTime(offer.startMinutes);
      const slotStart = new Date(`${p.opening.date}T${startTime}:00`);
      const expiry = offerExpiryAt(policy, slotStart, now);
      // O espaço passou a ser passado entre o cálculo e o envio (uma corrida
      // longa, uma clínica a fechar). Não se oferece o que já não existe.
      if (!expiry) continue;

      const closing = autoBook
        ? 'Responda SIM para confirmar (fica marcada) ou NÃO para dispensar.'
        : 'Responda SIM se lhe der jeito e nós confirmamos.';
      const intro =
        c.source === 'advance' && c.currentAppointmentDate
          ? `podemos antecipar a sua consulta de ${formatPtDate(c.currentAppointmentDate)}`
          : `temos uma vaga para ${c.treatmentType}`;
      const body = `Olá ${c.patientName}, ${intro} na ${clinicName} em ${formatPtDate(p.opening.date)} às ${startTime}. ${closing}`;

      const created = await createOffer(tenantId, {
        source: c.source,
        patientId: c.patientId,
        patientName: c.patientName,
        phone: c.phone,
        waitlistEntryId: c.source === 'waitlist' ? c.sourceId : null,
        advanceFromAppointmentId: c.source === 'advance' ? c.currentAppointmentId : null,
        date: p.opening.date,
        startTime,
        duration: c.durationMinutes,
        chair: p.opening.chair,
        dentistId: offer.dentist?.dentistId || null,
        type: c.treatmentType,
        score: offer.score,
        reason: [offer.reason, notes[p.opening.key]].filter(Boolean).join(' — '),
        estimatedValueEur: c.valueEur || null,
        expiresAt: expiry.expiresAt,
        autoBook,
        notificationKind: 'dynamic_offer',
        messageBody: body,
      });
      if (created) {
        offersSent += 1;
        sentHere += 1;
      }
    }
    if (sentHere) slotsTouched += 1;
  }

  if (offersSent) {
    await appendAudit(
      actor,
      'CREATE',
      `Agente de Agenda: ${offersSent} ${offersSent === 1 ? 'oferta enviada' : 'ofertas enviadas'} para ${slotsTouched} ${slotsTouched === 1 ? 'espaço livre' : 'espaços livres'}`,
      null,
      `${policy.mode}/${decidedBy}`,
      actor.clinic,
    );
  }

  return { mode: policy.mode, decidedBy, offersSent, slotsTouched, skipped: null, plan };
}
