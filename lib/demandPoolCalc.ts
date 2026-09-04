// Puro — sem imports de DB, testável como lib/scheduleOptimizerCalc.ts. A metade
// que lê a base de dados é lib/demandPool.ts; quem junta as duas com os espaços
// livres da agenda é lib/dynamicScheduling.ts.
//
// ─── O problema ────────────────────────────────────────────────────────────
//
// A pergunta que a agenda respondia até aqui era a do doente: "quando quer
// marcar?" (lib/scheduling.ts, suggestAppointmentSlots). A pergunta que falta é
// a da clínica: "esta cadeira está livre amanhã às 14:30 — de toda a gente que
// eu conheço, quem é que devia estar sentado nela?".
//
// A diferença não é de grau. Na primeira, o doente é dado e procuram-se
// horários. Na segunda, o horário é dado e procuram-se doentes — e o universo
// deixa de ser uma pessoa para ser a base inteira.
//
// ─── Porque é que a lista de espera não chega ──────────────────────────────
//
// A lista de espera (lib/waitlistMatch.ts) responde a esta segunda pergunta,
// mas só sobre quem fez opt-in explícito. Numa clínica com milhares de fichas,
// a lista de espera tem dezenas de nomes: é a ponta visível da procura, não a
// procura. A procura real está espalhada por sítios que já existem na base e
// que ninguém cruzava com um buraco na agenda:
//
//   treatment_open  — um plano que o doente ACEITOU e que está parado sem
//                     próxima sessão marcada. É a procura mais valiosa que
//                     existe: já há sim do doente e já há valor apurado.
//   recall_due      — uma higiene/revisão que venceu. O doente concordou com a
//                     periodicidade quando a marcou.
//   advance         — quem tem consulta daqui a três semanas e viria amanhã. Não
//                     acrescenta receita nova, mas troca uma cadeira vazia hoje
//                     por uma cadeira vazia lá longe, que é muito mais fácil de
//                     voltar a preencher.
//   reactivation    — inativos. A fonte mais fria, e por isso a única que a
//                     política não liga por omissão.
//
// ─── O que isto NÃO faz ────────────────────────────────────────────────────
//
// Não contacta ninguém e não marca nada: devolve um plano. Quem decide se o
// plano sai daqui é a política da clínica (lib/schedulingPolicyCalc.ts).

import { getAppointmentTypeOption } from './constants';
import { preferenceFit, type SchedulingPreferences } from './schedulingPrefsCalc';

export type DemandSource = 'waitlist' | 'treatment_open' | 'recall_due' | 'advance' | 'reactivation';

export const DEMAND_SOURCES: DemandSource[] = ['waitlist', 'treatment_open', 'recall_due', 'advance', 'reactivation'];

export const SOURCE_LABEL_PT: Record<DemandSource, string> = {
  waitlist: 'Lista de espera',
  treatment_open: 'Plano parado',
  recall_due: 'Recall vencido',
  advance: 'Antecipação',
  reactivation: 'Reativação',
};

// Quão explicitamente é que o doente já disse que quer isto. É o fator mais
// pesado do modelo e a ordem não é discutível: quem se inscreveu numa lista de
// espera pediu para ser chamado; um inativo não pediu nada a ninguém.
export const SOURCE_INTENT: Record<DemandSource, number> = {
  waitlist: 1,
  treatment_open: 0.8,
  recall_due: 0.6,
  advance: 0.5,
  reactivation: 0.25,
};

// Mesma forma dos RISK_WEIGHTS de lib/noShowRisk.ts: soma 1, cada fator é 0..1,
// e as contribuições saem com o resultado para a página poder explicar a
// pontuação em vez de mostrar um número que ninguém sabe de onde vem.
export const DEMAND_WEIGHTS = {
  // Já pediu isto?
  intent: 0.3,
  // O horário serve-lhe, pelo que ele próprio declarou?
  preference: 0.15,
  // Está atrasado? Um recall vencido há seis meses é mais urgente do que um de
  // ontem.
  urgency: 0.2,
  // Vale a pena, em euros.
  value: 0.15,
  // Vem mesmo? Um doente com histórico de faltas preenche a cadeira no papel e
  // deixa-a vazia na prática.
  reliability: 0.2,
};

// Acima disto o valor deixa de diferenciar: uma reabilitação de 3.000 € e uma de
// 1.500 € são ambas "muito valiosa", e sem teto o fator do valor esmagava todos
// os outros e transformava o agente num vendedor.
export const VALUE_CEILING_EUR = 400;
// Idem para o atraso: a partir de dois meses vencido, mais tempo não acrescenta
// urgência — acrescenta é a probabilidade de a pessoa já ter ido a outro lado.
export const OVERDUE_CEILING_DAYS = 60;

export interface DemandCandidate {
  /** Estável entre corridas: `${source}:${sourceId}`. */
  key: string;
  source: DemandSource;
  /** Id da linha de origem (entrada da lista, tratamento, recall, consulta). */
  sourceId: string;
  patientId: string;
  patientName: string;
  phone: string | null;
  /** Já filtrado por lib/commPrefs.ts — false = o doente disse "não me mandem SMS". */
  canSms: boolean;
  /** O tipo de consulta a oferecer; casa com APPOINTMENT_TYPES/appointments.type. */
  treatmentType: string;
  durationMinutes: number;
  valueEur: number;
  /** Dias de atraso (recall/plano) ou 0 quando a fonte não tem prazo. */
  overdueDays: number;
  /** 0..1, de lib/noShowRisk.ts. */
  noShowRisk: number;
  prefs: SchedulingPreferences | null;
  /** Prazo máximo que o doente aceita esperar (lista de espera). */
  maxWaitUntil: string | null;
  /** Dias em que o doente já tem consulta marcada — não se oferece duas no mesmo dia. */
  busyDates: string[];
  /** Antecipação: a consulta que esta oferta substituiria. */
  currentAppointmentId: string | null;
  currentAppointmentDate: string | null;
  /** Último contacto automático, para o intervalo mínimo da política. */
  lastContactedAt: string | null;
}

export interface OpeningDentist {
  dentistId: string;
  dentistName: string;
  specialties: string[];
  /** Janela em que este dentista está livre e de turno, em minutos desde a meia-noite. */
  freeFrom: number;
  freeTo: number;
}

/** Um espaço livre concreto: cadeira, dia, janela, e quem o pode atender. */
export interface OpeningSlot {
  key: string;
  chair: number;
  date: string;
  startMinutes: number;
  endMinutes: number;
  /** 'gap' = buraco entre consultas (capacidade morta); 'edge' = ponta do dia. */
  kind: 'gap' | 'edge';
  equipmentTags: string[];
  dentists: OpeningDentist[];
}

// Aviso mínimo que se dá a um doente. Uma vaga daqui a vinte minutos não é uma
// oferta — é um convite a que ele falte, e a falta conta para o histórico dele.
export const MIN_LEAD_MINUTES = 120;

/**
 * O início útil de um espaço, contando com a hora a que estamos.
 *
 * Um espaço de hoje começa onde o dia começa, e às três da tarde metade dele já
 * não existe. Sem isto, a página propõe encaixes às 09:00 de hoje a quem os lê
 * às 15:00 — e a única coisa que trava o disparate é o cálculo da validade da
 * oferta, já no fim da linha, a recusar um horário no passado. Um travão que só
 * atua no último metro deixa o erro visível durante o percurso todo.
 *
 * Devolve null quando o que resta do espaço já não chega para nada.
 */
export function effectiveOpeningStart(
  opening: { date: string; startMinutes: number; endMinutes: number },
  today: string,
  nowMinutes: number,
  minDuration = 30,
  leadMinutes = MIN_LEAD_MINUTES,
): number | null {
  if (opening.date < today) return null;
  const earliest =
    opening.date === today ? Math.max(opening.startMinutes, nowMinutes + leadMinutes) : opening.startMinutes;
  if (opening.endMinutes - earliest < minDuration) return null;
  return earliest;
}

export interface FitResult {
  ok: boolean;
  /** Porque não coube. Vazio quando coube — a razão do "sim" é a pontuação. */
  blockers: string[];
  /** O dentista que fica com a consulta, escolhido entre os disponíveis. */
  dentist: OpeningDentist | null;
  /** Onde dentro do espaço a consulta começaria. */
  startMinutes: number;
}

/**
 * Filtros duros: o que torna a oferta impossível ou errada, não o que a torna
 * pior. Uma preferência violada NÃO entra aqui — desce a pontuação e é dita ao
 * doente, mas nunca elimina (é a mesma regra que lib/scheduling.ts já seguia, e
 * a diferença explícita face a lib/waitlistMatch.ts, que filtra porque ali o
 * doente escreveu o que aceitava).
 */
export function candidateFits(candidate: DemandCandidate, opening: OpeningSlot, today: string): FitResult {
  const blockers: string[] = [];

  if (opening.date < today) blockers.push('espaço no passado');
  if (opening.endMinutes - opening.startMinutes < candidate.durationMinutes) {
    blockers.push(`espaço curto (${opening.endMinutes - opening.startMinutes} min < ${candidate.durationMinutes} min)`);
  }
  if (candidate.maxWaitUntil && opening.date > candidate.maxWaitUntil) {
    blockers.push(`além do prazo que o doente aceitou (${candidate.maxWaitUntil})`);
  }

  // Já lá está nesse dia. Para a antecipação isto é o normal e não um problema:
  // a consulta desse dia é justamente a que se quer trocar.
  const clashesWithOwnDay =
    candidate.busyDates.includes(opening.date) && candidate.currentAppointmentDate !== opening.date;
  if (clashesWithOwnDay) blockers.push('o doente já tem consulta nesse dia');

  // Antecipar para depois não é antecipar.
  if (candidate.source === 'advance') {
    if (!candidate.currentAppointmentDate) {
      blockers.push('sem consulta futura para antecipar');
    } else if (opening.date >= candidate.currentAppointmentDate) {
      blockers.push(`não antecipa (já tem consulta em ${candidate.currentAppointmentDate})`);
    }
  }

  // Equipamento: a cadeira tem de trazer TODAS as etiquetas que o procedimento
  // exige. Aqui é filtro e não aviso — ao contrário de lib/scheduling.ts, onde
  // uma pessoa vê o aviso e decide; um agente que oferece sozinho uma
  // endodontia numa cadeira sem motor endodôntico manda o doente a uma consulta
  // que não se pode fazer.
  const typeOption = getAppointmentTypeOption(candidate.treatmentType);
  const requiredTags = typeOption?.requiredEquipmentTags || [];
  const missingTags = requiredTags.filter((t) => !opening.equipmentTags.includes(t));
  if (missingTags.length) blockers.push(`cadeira sem ${missingTags.join(', ')}`);

  // Dentista: tem de haver um de turno, livre à hora toda, e com a
  // especialidade quando o procedimento a exige. Mesma razão do parágrafo
  // acima para ser filtro.
  const requiredSpecialty = typeOption?.requiredSpecialty || null;
  const start = Math.max(opening.startMinutes, 0);
  const end = start + candidate.durationMinutes;
  const available = opening.dentists.filter((d) => {
    if (d.freeFrom > start || d.freeTo < end) return false;
    if (requiredSpecialty && !d.specialties.includes(requiredSpecialty)) return false;
    return true;
  });
  if (!available.length) {
    blockers.push(
      requiredSpecialty ? `sem dentista de ${requiredSpecialty} livre` : 'sem dentista livre nesse horário',
    );
  }

  // Preferência de dentista do doente entre os disponíveis — aqui é desempate,
  // não requisito: se o preferido não estiver livre, o horário continua a ser
  // oferecido com outro (e a violação aparece na pontuação).
  const preferred = candidate.prefs?.preferredDentistId;
  const dentist = available.find((d) => d.dentistId === preferred) || available[0] || null;

  return { ok: blockers.length === 0, blockers, dentist, startMinutes: start };
}

export interface DemandScore {
  score: number;
  factors: Record<keyof typeof DEMAND_WEIGHTS, number>;
  contributions: Record<keyof typeof DEMAND_WEIGHTS, number>;
  /** Frases prontas para a página, na ordem em que pesam. */
  reasons: string[];
  preferenceViolations: string[];
}

function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * A pontuação 0-100 de pôr ESTE doente NESTE espaço. Determinística e
 * explicável, como o risco de falta — não há aqui aprendizagem nenhuma, e o
 * projeto não tem infraestrutura para a haver. O que há é uma soma pesada que
 * qualquer pessoa da clínica consegue auditar quando discordar dela.
 */
export function scoreCandidate(candidate: DemandCandidate, opening: OpeningSlot, fit: FitResult): DemandScore {
  const fitPrefs = preferenceFit(candidate.prefs, {
    date: opening.date,
    startMinutes: fit.startMinutes,
    durationMinutes: candidate.durationMinutes,
    dentistId: fit.dentist?.dentistId || null,
  });

  // Sem preferências declaradas não há nada por respeitar nem por violar — conta
  // como neutro-bom (1), pela mesma razão que matchesPreferences é true nesse
  // caso em lib/types/scheduling.ts.
  const preference = fitPrefs.applicable > 0 ? fitPrefs.score / fitPrefs.applicable : 1;

  // A antecipação não tem atraso; a urgência dela é quanto tempo se ganha.
  const urgency =
    candidate.source === 'advance' && candidate.currentAppointmentDate
      ? clamp01(daysBetween(opening.date, candidate.currentAppointmentDate) / OVERDUE_CEILING_DAYS)
      : clamp01(candidate.overdueDays / OVERDUE_CEILING_DAYS);

  const factors = {
    intent: SOURCE_INTENT[candidate.source] ?? 0,
    preference: clamp01(preference),
    urgency,
    value: clamp01(candidate.valueEur / VALUE_CEILING_EUR),
    reliability: 1 - clamp01(candidate.noShowRisk),
  };

  const contributions = Object.fromEntries(
    (Object.keys(DEMAND_WEIGHTS) as Array<keyof typeof DEMAND_WEIGHTS>).map((k) => [k, factors[k] * DEMAND_WEIGHTS[k]]),
  ) as Record<keyof typeof DEMAND_WEIGHTS, number>;

  const score = Math.round(clamp01(Object.values(contributions).reduce((a, b) => a + b, 0)) * 100);

  const reasons: string[] = [SOURCE_LABEL_PT[candidate.source]];
  if (candidate.source === 'advance' && candidate.currentAppointmentDate) {
    reasons.push(`antecipa ${daysBetween(opening.date, candidate.currentAppointmentDate)} dias`);
  } else if (candidate.overdueDays > 0) {
    reasons.push(`em atraso há ${candidate.overdueDays} dias`);
  }
  if (candidate.valueEur > 0) reasons.push(`≈ ${Math.round(candidate.valueEur)} €`);
  if (candidate.noShowRisk >= 0.5) reasons.push(`risco de falta ${Math.round(candidate.noShowRisk * 100)}%`);
  if (fitPrefs.applicable > 0) {
    reasons.push(fitPrefs.satisfied ? 'respeita as preferências' : `contra: ${fitPrefs.violations.join('; ')}`);
  }

  return { score, factors, contributions, reasons, preferenceViolations: fitPrefs.violations };
}

export interface PlannedOffer {
  candidate: DemandCandidate;
  score: number;
  reason: string;
  dentist: OpeningDentist | null;
  startMinutes: number;
  preferenceViolations: string[];
}

export interface SlotPlan {
  opening: OpeningSlot;
  offers: PlannedOffer[];
}

/**
 * Atribui candidatos a espaços. Guloso e EXCLUSIVO — cada doente entra no plano
 * uma vez só, mesmo que caiba em quinze buracos.
 *
 * É a mesma decisão (e a mesma razão) de buildGapFillMoves em
 * lib/scheduleOptimizerCalc.ts: sem exclusividade, o mesmo doente aparecia em
 * todos os espaços, o total de capacidade recuperável ficava absurdo, e — o que
 * é pior aqui do que lá, porque lá era só um número numa página — o mesmo doente
 * recebia cinco SMS a oferecer-lhe cinco horários da mesma clínica.
 *
 * Ordem de preenchimento: buracos entre consultas primeiro (capacidade morta no
 * meio do dia), depois os mais próximos — um espaço amanhã tem menos tempo de
 * ser preenchido do que um daqui a duas semanas.
 */
export function planOffers(
  openings: OpeningSlot[],
  candidates: DemandCandidate[],
  today: string,
  opts: { maxPerSlot?: number; minScore?: number } = {},
): SlotPlan[] {
  const maxPerSlot = Math.max(1, opts.maxPerSlot ?? 3);
  const minScore = Math.max(0, opts.minScore ?? 0);

  const ordered = [...openings].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'gap' ? -1 : 1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return a.chair - b.chair;
  });

  const used = new Set<string>();
  const plans: SlotPlan[] = [];

  for (const opening of ordered) {
    const scored: PlannedOffer[] = [];
    for (const candidate of candidates) {
      if (used.has(candidate.key)) continue;
      const fit = candidateFits(candidate, opening, today);
      if (!fit.ok) continue;
      const s = scoreCandidate(candidate, opening, fit);
      if (s.score < minScore) continue;
      scored.push({
        candidate,
        score: s.score,
        reason: s.reasons.join(' · '),
        dentist: fit.dentist,
        startMinutes: fit.startMinutes,
        preferenceViolations: s.preferenceViolations,
      });
    }
    if (!scored.length) continue;

    scored.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      // Desempate estável para a mesma agenda dar sempre o mesmo plano — sem
      // isto, duas corridas seguidas podiam contactar pessoas diferentes.
      return a.candidate.key < b.candidate.key ? -1 : 1;
    });

    const offers = scored.slice(0, maxPerSlot);
    for (const o of offers) used.add(o.candidate.key);
    plans.push({ opening, offers });
  }

  return plans;
}

/** Uma oferta que o plano previa e a política não deixou sair, com o porquê. */
export interface WithheldOffer {
  offer: PlannedOffer;
  opening: OpeningSlot;
  reason: string;
}

/**
 * Aplica os travões da política que dependem do estado do dia: intervalo mínimo
 * desde o último contacto ao mesmo doente e teto diário da clínica. Separado de
 * planOffers de propósito — o plano é o que faz sentido clinicamente, isto é o
 * que a clínica autorizou hoje, e a página mostra os dois (o que se ia fazer, e
 * o que ficou de fora e porquê).
 */
export function applyContactLimits(
  plans: SlotPlan[],
  opts: { now: Date; cooldownDays: number; remainingToday: number; allowedSources: string[] },
): { toContact: SlotPlan[]; withheld: WithheldOffer[] } {
  const withheld: WithheldOffer[] = [];
  const toContact: SlotPlan[] = [];
  let budget = Math.max(0, opts.remainingToday);
  const cooldownMs = opts.cooldownDays * 86_400_000;

  for (const plan of plans) {
    const kept: PlannedOffer[] = [];
    for (const offer of plan.offers) {
      const c = offer.candidate;
      if (!opts.allowedSources.includes(c.source)) {
        withheld.push({
          offer,
          opening: plan.opening,
          reason: `fonte "${SOURCE_LABEL_PT[c.source]}" desligada na política`,
        });
        continue;
      }
      if (!c.canSms || !c.phone) {
        withheld.push({
          offer,
          opening: plan.opening,
          reason: c.phone ? 'doente recusou contacto por SMS' : 'sem telemóvel',
        });
        continue;
      }
      if (cooldownMs > 0 && c.lastContactedAt) {
        const since = opts.now.getTime() - Date.parse(c.lastContactedAt);
        if (Number.isFinite(since) && since < cooldownMs) {
          withheld.push({ offer, opening: plan.opening, reason: `contactado há menos de ${opts.cooldownDays} dias` });
          continue;
        }
      }
      if (budget <= 0) {
        withheld.push({ offer, opening: plan.opening, reason: 'teto diário de contactos atingido' });
        continue;
      }
      budget -= 1;
      kept.push(offer);
    }
    if (kept.length) toContact.push({ opening: plan.opening, offers: kept });
  }

  return { toContact, withheld };
}
