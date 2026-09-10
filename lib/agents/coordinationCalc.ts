// Puro — sem DB, sem IA, testável sem Postgres como lib/agents/registry.ts.
//
// ─── O que existia, e o que não ─────────────────────────────────────────────
// lib/agents/registry.ts agrupa as tarefas por quem decide o quê, e o cabeçalho dele
// diz a frase certa: «a comunicação não é um agente — é o canal por onde todos passam,
// e por isso a política vive num sítio só». A política que lá vivia era, no entanto,
// só metade: consentimento (lib/commPrefs.ts) e deduplicação por tipo de mensagem
// (o `SELECT 1 FROM notifications WHERE payload->>'kind'=...` repetido em cada
// queue*() de lib/jobsRunner.ts).
//
// Essa deduplicação é POR TIPO. Impede dois lembretes de consulta para a mesma
// consulta, e não impede nada entre agentes diferentes. Na prática, um doente com uma
// consulta amanhã, um plano por responder, um recall vencido e seis meses sem vir
// podia receber, na mesma passagem do cron:
//
//   reminders           «lembramos da sua consulta amanhã»
//   riskOutreach        «confirma a sua consulta?»
//   planFollowup        «o seu plano continua disponível»
//   recallOutreach      «está na altura de marcar a sua higiene»
//   lifecycleOutreach   «já não o vemos há algum tempo»
//
// Cinco SMS da mesma clínica no mesmo dia, dois deles a contradizerem-se — o quinto
// diz que não o vêem há muito a quem o primeiro lembra de vir amanhã. Cada agente
// estava certo isoladamente. É exatamente o que "sistema de agentes coordenados"
// quer dizer, e o que faltava.
//
// Este ficheiro é o árbitro. Nenhum agente contacta ninguém — todos PEDEM, e o que
// sai é decidido aqui, com uma regra que se pode ler.

// ─── 1. Prioridade ──────────────────────────────────────────────────────────
// A ordem é a política, tal como em lib/nextAction.ts. Do mais operacional e
// perecível para o mais frio e adiável:
//
//   Uma vaga de lista de espera expira em 24 horas (MAX_OFFERS_PER_SLOT em
//   lib/waitlist.ts) — perde-se de facto se esperar. Um lembrete de consulta tem uma
//   data. Uma reativação de um doente que não vem há oito meses pode perfeitamente
//   sair na próxima terça, e nada acontece.
//
// O critério NÃO é o valor em euros. Um plano de 5 000 € por responder vale mais do
// que um lembrete de uma higiene de 45 €, e mesmo assim o lembrete ganha: falhar o
// lembrete estraga uma consulta que já está marcada e paga, adiar o plano um dia
// custa um dia. Prioridade é sobre o que se perde por esperar, não sobre quanto vale.
export const CONTACT_PRIORITY = [
  'waitlist_offer',
  'appointment_reminder',
  'risk_outreach',
  'plan_followup',
  'recall_reminder',
  'lifecycle_reactivation',
] as const;

export type ContactKind = (typeof CONTACT_PRIORITY)[number];

export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  waitlist_offer: 'Oferta de vaga',
  appointment_reminder: 'Lembrete de consulta',
  risk_outreach: 'Confirmação preventiva',
  plan_followup: 'Seguimento de plano',
  recall_reminder: 'Recall',
  lifecycle_reactivation: 'Reativação',
};

export function priorityOf(kind: string): number {
  const i = (CONTACT_PRIORITY as readonly string[]).indexOf(kind);
  // Um tipo desconhecido fica no fim, nunca à frente: um agente novo não pode passar
  // à frente dos existentes só por ter sido escrito depois e ninguém se ter lembrado
  // de o classificar aqui.
  return i === -1 ? CONTACT_PRIORITY.length : i;
}

// Alguns contactos são operacionais e não são "comunicação de marketing" em nenhum
// sentido: um lembrete de uma consulta que o doente marcou, ou uma vaga que ele pediu
// para lhe ser oferecida. Estes não gastam o orçamento semanal — se gastassem, um
// doente em tratamento ativo, com consultas todas as semanas, esgotaria a quota nos
// lembretes e deixaria de poder ser contactado sobre o que interessa.
const OPERATIONAL_KINDS = new Set<ContactKind>(['waitlist_offer', 'appointment_reminder', 'risk_outreach']);

export function isOperational(kind: string): boolean {
  return OPERATIONAL_KINDS.has(kind as ContactKind);
}

// ─── 2. Orçamento de contacto ───────────────────────────────────────────────
// Um contacto por doente por dia, e um teto semanal para os não-operacionais.
//
// Dois é o teto semanal por uma razão simples: três mensagens promocionais numa
// semana é o ponto em que uma clínica deixa de parecer atenta e passa a parecer
// insistente, e a resposta do doente a isso não é marcar — é bloquear o número.
export const MAX_CONTACTS_PER_DAY = 1;
export const MAX_PROMOTIONAL_CONTACTS_PER_WEEK = 2;

export interface ContactRequest {
  // Que agente pediu. Só para o registo e para a UI poder mostrar quem cedeu a quem.
  agentId: string;
  kind: ContactKind | string;
  patientId: string;
  // Chave de deduplicação do próprio pedido (a consulta, o plano, o recall). Dois
  // pedidos com a mesma chave são o mesmo pedido.
  dedupeKey: string;
  body: string;
}

export interface PatientContactState {
  patientId: string;
  // Contactos já enviados hoje, qualquer que seja o agente.
  contactsToday: number;
  // Contactos promocionais (não-operacionais) enviados nos últimos 7 dias.
  promotionalThisWeek: number;
  // Consentimento/canal — já resolvido pelo chamador com lib/commPrefs.ts.
  canContact: boolean;
}

export type ContactDecision =
  | { granted: true; request: ContactRequest }
  | { granted: false; request: ContactRequest; reason: string; deferred: boolean };

// A decisão sobre um lote de pedidos, para uma clínica inteira, numa passagem.
//
// Guloso por prioridade, e o ponto importante é que os recusados são DIFERIDOS e não
// descartados: o agente de reativação que perde para o lembrete de consulta não perdeu
// a razão que tinha — volta a pedir amanhã. A única recusa definitiva é a que vem da
// vontade do doente (sem consentimento) ou de um pedido repetido.
export function arbitrateContacts(
  requests: ContactRequest[],
  states: Map<string, PatientContactState>,
): ContactDecision[] {
  const ordered = [...requests].sort((a, b) => {
    const pa = priorityOf(a.kind);
    const pb = priorityOf(b.kind);
    if (pa !== pb) return pa - pb;
    // Desempate estável por doente e chave — a mesma entrada produz sempre a mesma
    // saída, que é o que permite testar isto e o que impede a ordem de depender de
    // como o Postgres devolveu as linhas nesta corrida.
    if (a.patientId !== b.patientId) return a.patientId < b.patientId ? -1 : 1;
    return a.dedupeKey < b.dedupeKey ? -1 : 1;
  });

  // Estado mutável desta passagem — parte do estado que veio da base de dados, e vai
  // sendo consumido à medida que se concedem contactos.
  const budget = new Map<string, { today: number; week: number }>();
  const seen = new Set<string>();
  const decisions: ContactDecision[] = [];

  for (const request of ordered) {
    const state = states.get(request.patientId);
    // `?.` cobre os dois casos de uma vez, e são o mesmo caso: um doente sem estado
    // conhecido não é contactável, tal como um que recusou. Adivinhar num deles seria
    // adivinhar consentimento.
    if (!state?.canContact) {
      decisions.push({
        granted: false,
        request,
        reason: 'O doente não autoriza contacto automático.',
        deferred: false,
      });
      continue;
    }

    const requestKey = `${request.patientId}:${request.kind}:${request.dedupeKey}`;
    if (seen.has(requestKey)) {
      decisions.push({ granted: false, request, reason: 'Pedido repetido nesta passagem.', deferred: false });
      continue;
    }
    seen.add(requestKey);

    const used = budget.get(request.patientId) || { today: state.contactsToday, week: state.promotionalThisWeek };

    if (used.today >= MAX_CONTACTS_PER_DAY) {
      decisions.push({
        granted: false,
        request,
        reason: `Já foi contactado hoje (${CONTACT_KIND_LABELS[request.kind as ContactKind] || request.kind} fica para amanhã).`,
        deferred: true,
      });
      continue;
    }

    const promotional = !isOperational(request.kind);
    if (promotional && used.week >= MAX_PROMOTIONAL_CONTACTS_PER_WEEK) {
      decisions.push({
        granted: false,
        request,
        reason: `Já recebeu ${used.week} mensagens não urgentes esta semana.`,
        deferred: true,
      });
      continue;
    }

    used.today += 1;
    if (promotional) used.week += 1;
    budget.set(request.patientId, used);
    decisions.push({ granted: true, request });
  }

  return decisions;
}

// ─── 3. Contexto partilhado ─────────────────────────────────────────────────
// O segundo problema, mais silencioso do que o primeiro: cada agente lia a base de
// dados por si e chegava à sua própria versão do doente. O agente de recall via um
// recall vencido; o agente de doente via um plano por aceitar; nenhum dos dois sabia
// o que o outro tinha visto, e por isso nenhum dos dois podia decidir qual das duas
// coisas dizer primeiro.
//
// Isto é a versão única. Um snapshot por doente, calculado uma vez por passagem, lido
// por todos. Não é uma cache por desempenho — é uma cache por CONSISTÊNCIA: dois
// agentes a decidir sobre o mesmo doente têm de decidir sobre os mesmos factos, senão
// a arbitragem acima está a comparar coisas que não são comparáveis.
export interface SharedPatientContext {
  patientId: string;
  name: string;
  // De lib/patientScoringCalc.ts — os três números que dizem se vale a pena insistir.
  engagement: number;
  churnRisk: number;
  bookingPropensity: number;
  // De lib/patientJourneyCalc.ts.
  journeyStage: string;
  hasFutureAppointment: boolean;
  lastContactAt: string | null;
  contactsToday: number;
  promotionalThisWeek: number;
  canContact: boolean;
}

export function toContactState(ctx: SharedPatientContext): PatientContactState {
  return {
    patientId: ctx.patientId,
    contactsToday: ctx.contactsToday,
    promotionalThisWeek: ctx.promotionalThisWeek,
    canContact: ctx.canContact,
  };
}

// ─── 4. Coerência entre mensagens ───────────────────────────────────────────
// Além do orçamento, há combinações que não se devem enviar de todo — não porque
// sejam demasiadas, mas porque se contradizem. Uma reativação («já não o vemos há
// algum tempo») para quem tem consulta marcada para amanhã não é excesso de contacto:
// é a clínica a dizer ao doente que não sabe quem ele é.
//
// A arbitragem por orçamento não apanha isto: bastaria a reativação chegar num dia em
// que o lembrete não saiu. Por isso é uma regra à parte, e é uma recusa definitiva —
// diferir não a torna correta amanhã.
export function isIncoherent(kind: string, ctx: SharedPatientContext): string | null {
  if (ctx.hasFutureAppointment && (kind === 'lifecycle_reactivation' || kind === 'recall_reminder')) {
    return 'O doente já tem consulta marcada — esta mensagem contradiz o que a clínica sabe dele.';
  }
  if (kind === 'lifecycle_reactivation' && ctx.churnRisk < 20) {
    return 'O doente não está em risco de abandono — a reativação não se aplica.';
  }
  return null;
}

// A passagem completa: aplica coerência antes de orçamento. Pela ordem inversa, uma
// mensagem incoerente podia gastar a quota do dia e bloquear uma correta.
export function coordinateContacts(
  requests: ContactRequest[],
  contexts: Map<string, SharedPatientContext>,
): ContactDecision[] {
  const coherent: ContactRequest[] = [];
  const rejected: ContactDecision[] = [];

  for (const request of requests) {
    const ctx = contexts.get(request.patientId);
    if (!ctx) {
      rejected.push({ granted: false, request, reason: 'Sem contexto para este doente.', deferred: false });
      continue;
    }
    const incoherent = isIncoherent(request.kind, ctx);
    if (incoherent) {
      rejected.push({ granted: false, request, reason: incoherent, deferred: false });
      continue;
    }
    coherent.push(request);
  }

  const states = new Map(Array.from(contexts.values()).map((c) => [c.patientId, toContactState(c)]));
  return [...arbitrateContacts(coherent, states), ...rejected];
}

// Resumo de uma passagem, para o registo em job_runs e para a página de Agentes poder
// mostrar quem cedeu a quem — que é a única maneira de alguém confiar num árbitro.
export interface CoordinationSummary {
  granted: number;
  deferred: number;
  rejected: number;
  byAgent: Record<string, { granted: number; deferred: number; rejected: number }>;
  // As cedências concretas, para se poder ler "a reativação de 3 doentes ficou para
  // amanhã porque o lembrete de consulta ganhou".
  yields: Array<{ agentId: string; kind: string; reason: string; count: number }>;
}

export function summarizeCoordination(decisions: ContactDecision[]): CoordinationSummary {
  const byAgent: CoordinationSummary['byAgent'] = {};
  const yieldsMap = new Map<string, { agentId: string; kind: string; reason: string; count: number }>();
  let granted = 0;
  let deferred = 0;
  let rejected = 0;

  for (const d of decisions) {
    const agent = d.request.agentId;
    byAgent[agent] ||= { granted: 0, deferred: 0, rejected: 0 };
    if (d.granted) {
      granted += 1;
      byAgent[agent].granted += 1;
      continue;
    }
    if (d.deferred) {
      deferred += 1;
      byAgent[agent].deferred += 1;
    } else {
      rejected += 1;
      byAgent[agent].rejected += 1;
    }
    const key = `${agent}:${d.request.kind}:${d.reason}`;
    const entry = yieldsMap.get(key) || { agentId: agent, kind: String(d.request.kind), reason: d.reason, count: 0 };
    entry.count += 1;
    yieldsMap.set(key, entry);
  }

  return {
    granted,
    deferred,
    rejected,
    byAgent,
    yields: Array.from(yieldsMap.values()).sort((a, b) => b.count - a.count),
  };
}
