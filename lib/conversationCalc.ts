// Puro — sem DB, sem IA, sem rede. Testável como lib/agents/leadAgentCalc.ts.
//
// ═══ O canal de entrada ═════════════════════════════════════════════════════
// Até aqui o sistema ENVIA e não CONVERSA: havia SMS a sair por seis motivos diferentes
// e nenhum webhook de receção. Um doente que respondesse «podem mudar para a semana
// seguinte?» estava a falar com uma parede. Toda a inteligência de que essa conversa
// precisa — disponibilidade, preferências, cadeira, equipamento, risco de falta — já
// estava construída e testada. Faltava a porta.
//
// ─── Dois canais, por decisão de produto ────────────────────────────────────
// SMS e chamada. Nada de WhatsApp, nada de e-mail. Cada canal a mais é uma superfície de
// ataque (um webhook público), uma conta de terceiros a manter, um formato de payload a
// normalizar e um caminho de código que ninguém exercita — e o WhatsApp Business
// acrescenta ainda verificação Meta e templates aprovados. Dois canais que funcionam
// valem mais do que cinco por ligar.
//
// `patients.email` continua a existir: é campo de registo — identifica o doente, aparece
// em faturas e no portal. O que saiu foi o e-mail como VIA de comunicação do agente.
//
// Este ficheiro é a parte da porta que não depende de fornecedor nenhum: o estado de
// uma conversa, a classificação do que o doente quer, e a decisão de quando é que um
// humano tem de entrar. lib/inbound.ts liga isto às tabelas; as rotas de webhook
// ligam-no aos canais.
//
// ─── Três regras que não são negociáveis ────────────────────────────────────
//
// 1. QUALQUER COISA CLÍNICA ESCALA. Dor, inchaço, sangramento, febre, um dente
//    partido — o software não interpreta sintomas, não tria urgências e não
//    tranquiliza ninguém. É a fronteira do produto inteiro («qualquer decisão
//    clínica» está fora de âmbito por decisão), e aqui é onde ela seria mais fácil
//    de atravessar sem dar por isso: um modelo de linguagem responde a «dói-me muito»
//    com uma frase simpática sem hesitar nenhuma.
//
// 2. O PEDIDO DE NÃO SER CONTACTADO É SEMPRE PROCESSADO. Independentemente do nível
//    de autonomia, do canal e do estado da conversa. Não é uma funcionalidade, é uma
//    obrigação legal — a retirada do consentimento tem de ser tão fácil como o dar.
//    Por isso é a PRIMEIRA regra a correr, antes de tudo o resto.
//
// 3. NADA SAI SOZINHO ATÉ ALGUÉM DECIDIR QUE PODE. A autonomia é uma definição por
//    clínica com o valor de repouso em 'off' — ver AUTONOMY_LEVELS abaixo. Não é
//    timidez: é que a pergunta «a IA pode falar sozinha com um doente?» é uma decisão
//    de produto e de responsabilidade, e escrevê-la no código seria tomá-la por quem
//    a tem de tomar.

export const CONVERSATION_CHANNELS = ['sms', 'voice'] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  sms: 'SMS',
  voice: 'Chamada',
};

// ─── A chamada nunca recebe resposta automática ─────────────────────────────
// Não é uma limitação técnica à espera de ser levantada — é o que «chamada» significa.
// Responder a uma chamada é falar, e falar é uma pessoa. O que chega por voz é uma
// transcrição do que alguém disse ao telefone; o que o sistema faz com isso é classificar
// e pôr na caixa de entrada de quem vai ligar de volta.
//
// Sem esta regra, o degrau 'informational' responderia a «até que horas estão abertos?»
// dito ao telefone com um SMS que o doente não pediu — que é pior do que não responder,
// porque parece que alguém tratou do assunto.
const NEVER_AUTO_REPLY_CHANNELS = new Set<ConversationChannel>(['voice']);

export function allowsAutoReply(channel: ConversationChannel): boolean {
  return !NEVER_AUTO_REPLY_CHANNELS.has(channel);
}

export function isConversationChannel(v: unknown): v is ConversationChannel {
  return typeof v === 'string' && (CONVERSATION_CHANNELS as readonly string[]).includes(v);
}

// ─── 1. Estado da conversa ──────────────────────────────────────────────────
// Cinco estados, e a diferença entre os dois do meio é a única que interessa a quem
// está ao balcão: `awaiting_staff` é a caixa de entrada — coisas que esperam por nós.
// `awaiting_patient` é o que já respondemos e espera por eles. Uma caixa de entrada que
// misture as duas é uma caixa de entrada que ninguém consegue esvaziar.
export const CONVERSATION_STATES = ['awaiting_staff', 'awaiting_patient', 'escalated', 'resolved', 'closed'] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

export const CONVERSATION_STATE_LABELS: Record<ConversationState, string> = {
  awaiting_staff: 'A aguardar resposta da clínica',
  awaiting_patient: 'A aguardar o doente',
  escalated: 'Escalado',
  resolved: 'Resolvido',
  closed: 'Fechado',
};

// Transições válidas. Mesma abordagem da máquina de estados das consultas
// (app/api/appointments/[id]/status): o servidor valida, transições inválidas dão 400,
// e a máquina vive num sítio só em vez de espalhada por condições nas rotas.
//
// 'escalated' não volta atrás para 'awaiting_staff': uma conversa que precisou de uma
// pessoa fica marcada como tal para o histórico. Resolve-se ou fecha-se.
const TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  awaiting_staff: ['awaiting_patient', 'escalated', 'resolved', 'closed'],
  awaiting_patient: ['awaiting_staff', 'escalated', 'resolved', 'closed'],
  escalated: ['awaiting_patient', 'resolved', 'closed'],
  resolved: ['awaiting_staff', 'closed'],
  closed: [],
};

export function canTransition(from: ConversationState, to: ConversationState): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

// Uma mensagem que entra reabre sempre a conversa, mesmo que estivesse resolvida: o
// doente não sabe (nem tem de saber) que alguém carregou num botão a dizer que aquilo
// estava tratado. A única exceção é 'closed', que é o arquivo — uma mensagem nova aí
// abre uma conversa nova, para o histórico não se transformar num fio infinito.
export function stateAfterInbound(current: ConversationState): ConversationState {
  if (current === 'closed') return 'closed';
  if (current === 'escalated') return 'escalated';
  return 'awaiting_staff';
}

// ─── 2. Intenções ───────────────────────────────────────────────────────────
// Classificador determinístico. Não é o mecanismo mais esperto possível — é o que
// funciona sem chave de API, sem rede e sem variar entre execuções, e é por isso que é
// a base e não o acessório. Um modelo de linguagem pode afinar a classificação por
// cima (mesmo padrão de lib/agents/leadAgent.ts: com chave refina, sem chave a regra
// fixa continua a decidir), mas nunca substitui as duas regras de segurança abaixo.

export const INTENTS = [
  'stop',
  'clinical',
  'cancel',
  'reschedule',
  'confirm',
  'book',
  'billing',
  'documents',
  'hours',
  'location',
  'other',
] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABELS: Record<Intent, string> = {
  stop: 'Pedido para não ser contactado',
  clinical: 'Assunto clínico',
  cancel: 'Cancelar consulta',
  reschedule: 'Remarcar consulta',
  confirm: 'Confirmar consulta',
  book: 'Marcar consulta',
  billing: 'Pagamentos e valores',
  documents: 'Documentos',
  hours: 'Horários',
  location: 'Localização',
  other: 'Outro',
};

// Normaliza para comparar: minúsculas, sem acentos, sem pontuação. Sem isto,
// «não enviem» e «nao enviem» seriam coisas diferentes, e a segunda é a que chega por
// SMS na maior parte das vezes.
export function normalize(text: unknown): string {
  return (
    String(text ?? '')
      .toLowerCase()
      .normalize('NFD')
      // Combining diacritical marks: separa-se o acento da letra com NFD e deita-se fora
      // o acento, para «não enviem» e «nao enviem» serem a mesma mensagem — e a segunda
      // é a que chega por SMS na maior parte das vezes.
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// A ordem destas verificações É a política de segurança, e não uma questão de estilo.
// 'stop' antes de tudo porque é obrigação legal; 'clinical' logo a seguir porque uma
// mensagem que diga «tenho muitas dores, quero remarcar» tem de escalar, não de ser
// tratada como uma remarcação de rotina — a remarcação é o que a pessoa pede, a dor é
// o que importa.
const STOP_WORDS = [
  'stop',
  'nao quero receber',
  'nao enviem',
  'nao me enviem',
  'nao contactem',
  'nao me contactem',
  'remover da lista',
  'retirar consentimento',
  'cancelar subscricao',
  'parar mensagens',
  'unsubscribe',
];

const CLINICAL_WORDS = [
  'dor',
  'dores',
  'doi',
  'doe',
  'inchado',
  'inchaco',
  'inflamado',
  'infecao',
  'infecionado',
  'abcesso',
  'abscesso',
  'sangra',
  'sangramento',
  'febre',
  'pus',
  'partiu',
  'partido',
  'partida',
  'caiu o dente',
  'caiu a coroa',
  'urgencia',
  'urgente',
  'emergencia',
  'nao consigo comer',
  'nao consigo dormir',
  'anestesia',
  'alergia',
  'antibiotico',
];

// Cada intenção declara termos FORTES e termos AMBÍGUOS, e a distinção não é
// cosmética: é ela que decide se um nível de autonomia mais alto pode responder
// sozinho. «cancelar» só quer dizer uma coisa numa clínica; «consulta» aparece em
// qualquer mensagem, incluindo nas que pedem o contrário.
//
// A alternativa óbvia — pesar pelo comprimento da expressão — não serve: faria
// «morada» (inequívoco) valer menos do que «que horas» (duas palavras).
interface IntentTerms {
  strong: string[];
  ambiguous: string[];
}

const TERMS: Record<string, IntentTerms> = {
  cancel: {
    strong: ['cancelar', 'desmarcar', 'anular', 'nao vou poder ir', 'nao posso ir', 'nao vou conseguir ir'],
    ambiguous: [],
  },
  reschedule: {
    strong: [
      'remarcar',
      'reagendar',
      'mudar a consulta',
      'mudar a hora',
      'mudar o dia',
      'adiar',
      'antecipar',
      'semana seguinte',
      'proxima semana',
    ],
    // Sozinhas não chegam: «passar para» e «outro dia» aparecem em frases que não são
    // pedidos de remarcação.
    ambiguous: ['passar para', 'outro dia', 'outra hora'],
  },
  documents: {
    strong: ['recibo', 'fatura', 'declaracao', 'comprovativo', 'atestado', 'justificacao'],
    ambiguous: [],
  },
  billing: {
    strong: ['quanto custa', 'quanto fica', 'orcamento', 'preco', 'precos', 'pagamento', 'divida'],
    ambiguous: ['pagar', 'valor'],
  },
  // Antes de 'hours' de propósito: «tem horário disponível?» é um pedido de marcação,
  // não uma pergunta sobre o horário de funcionamento. E depois de 'reschedule', porque
  // «remarcar» contém «marcar».
  book: {
    strong: ['marcar', 'agendar', 'vaga', 'disponibilidade', 'horario disponivel', 'quero ir'],
    ambiguous: ['consulta'],
  },
  hours: {
    strong: ['que horas', 'estao abertos', 'ate que horas', 'fecham', 'abrem', 'horario'],
    ambiguous: ['aberto'],
  },
  location: {
    strong: ['morada', 'onde fica', 'onde e', 'endereco', 'como chegar', 'estacionamento', 'localizacao'],
    ambiguous: [],
  },
};

const CONFIRM_WORDS = ['confirmo', 'confirmar', 'confirmado', 'sim', 'ok', 'esta bem', 'combinado', 'certo'];

export interface IntentMatch {
  intent: Intent;
  // 'high' quando a frase contém uma expressão inequívoca; 'low' quando só bateu numa
  // palavra que também aparece noutros contextos. É o que decide se um nível de
  // autonomia mais alto pode agir ou se manda para uma pessoa à mesma.
  confidence: 'high' | 'low';
  // As expressões que dispararam, para a conversa mostrar porque foi classificada
  // assim — quem lê tem de poder discordar do classificador.
  matched: string[];
}

export function classifyIntent(text: unknown): IntentMatch {
  const t = normalize(text);
  if (!t) return { intent: 'other', confidence: 'low', matched: [] };

  // 1. Retirada de consentimento — sempre primeiro, sempre.
  // 'stop' sozinho é uma mensagem inteira, não uma subcadeia: senão «não consigo
  // parar de sangrar» seria lido como um opt-out.
  const stopMatches = STOP_WORDS.filter((w) => (w === 'stop' || w === 'unsubscribe' ? t === w : t.includes(w)));
  if (stopMatches.length) return { intent: 'stop', confidence: 'high', matched: stopMatches };

  // 2. Clínico — antes de qualquer intenção administrativa, mesmo que a mensagem
  // contenha as duas coisas.
  const clinicalMatches = CLINICAL_WORDS.filter((w) => t.includes(w));
  if (clinicalMatches.length) return { intent: 'clinical', confidence: 'high', matched: clinicalMatches };

  // 3. Administrativo. A ordem é a política e está justificada em TERMS acima: o
  // primeiro a bater ganha, por isso 'reschedule' vem antes de 'book' («remarcar»
  // contém «marcar») e 'book' antes de 'hours' («tem horário disponível?» é um pedido
  // de marcação, não uma pergunta sobre o horário de funcionamento).
  const ordered: Intent[] = ['cancel', 'reschedule', 'documents', 'billing', 'book', 'hours', 'location'];
  for (const intent of ordered) {
    const terms = TERMS[intent];
    const strong = terms.strong.filter((w) => t.includes(w));
    const ambiguous = terms.ambiguous.filter((w) => t.includes(w));
    if (!strong.length && !ambiguous.length) continue;
    return {
      intent,
      confidence: strong.length ? 'high' : 'low',
      matched: [...strong, ...ambiguous],
    };
  }

  // 4. Confirmação por último: «sim» e «ok» são respostas, e só significam confirmação
  // no contexto de uma pergunta que a clínica fez. Uma mensagem que só diga «sim» com
  // mais nada é isso; «sim, mas quanto custa?» já é outra coisa e foi apanhada acima.
  const confirmMatches = CONFIRM_WORDS.filter((w) => t === w || t.startsWith(`${w} `));
  if (confirmMatches.length) {
    return { intent: 'confirm', confidence: t.split(' ').length <= 3 ? 'high' : 'low', matched: confirmMatches };
  }

  return { intent: 'other', confidence: 'low', matched: [] };
}

// ─── 3. Autonomia ───────────────────────────────────────────────────────────
// A escada. Cada degrau é uma decisão separada, e uma clínica pode parar em qualquer
// um deles. O valor de repouso é 'off' porque é o único que não pressupõe uma decisão
// que ainda não foi tomada.
export const AUTONOMY_LEVELS = ['off', 'acknowledge', 'informational', 'transactional'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  off: 'Desligada — tudo vai para uma pessoa',
  acknowledge: 'Só acusa a receção',
  informational: 'Responde a factos verificáveis',
  transactional: 'Confirma, cancela e propõe remarcação',
};

export const AUTONOMY_NOTES: Record<AutonomyLevel, string> = {
  off: 'Nenhuma mensagem sai sem uma pessoa a escrever ou a aprovar. É o comportamento de repouso e o que a fronteira do produto assume hoje.',
  acknowledge:
    'Sai apenas «recebemos a sua mensagem». Não responde a nada, não decide nada — serve para o doente saber que não falou para o vazio fora de horas.',
  informational:
    'Responde a perguntas cuja resposta está escrita em algum lado e não muda com o doente: horário, morada, estacionamento. Nunca preços de tratamento (dependem do caso), nunca nada clínico.',
  transactional:
    'Além do acima, pode registar uma confirmação, registar um cancelamento e propor horários a partir da disponibilidade real. Continua a NÃO poder marcar sozinha uma primeira consulta nem alterar um tratamento.',
};

export function isAutonomyLevel(v: unknown): v is AutonomyLevel {
  return typeof v === 'string' && (AUTONOMY_LEVELS as readonly string[]).includes(v);
}

export const DEFAULT_AUTONOMY: AutonomyLevel = 'off';

// Intenções que cada degrau consegue tratar sozinho. Note-se o que NUNCA aparece em
// nenhum: 'clinical' e 'billing'. A primeira por ser fronteira do produto; a segunda
// porque um preço de tratamento depende do caso, e um número errado dito por escrito
// por uma clínica é um compromisso que ela vai ter de honrar.
const AUTONOMY_SCOPE: Record<AutonomyLevel, Set<Intent>> = {
  off: new Set(),
  acknowledge: new Set(),
  informational: new Set<Intent>(['hours', 'location']),
  transactional: new Set<Intent>(['hours', 'location', 'confirm', 'cancel', 'reschedule']),
};

// ─── 4. A decisão ───────────────────────────────────────────────────────────

export type ConversationAction =
  // Processar a retirada de consentimento e confirmar. Não passa por autonomia
  // nenhuma — é obrigação legal, e a confirmação de que foi feito é parte dela.
  | 'process_optout'
  // Criar tarefa para uma pessoa, com prioridade normal.
  | 'human_task'
  // Criar tarefa marcada como urgente e escalar. Só para o clínico.
  | 'escalate'
  // Enviar só o acuso de receção.
  | 'auto_acknowledge'
  // Responder automaticamente ao que foi perguntado.
  | 'auto_reply';

export interface RoutingDecision {
  action: ConversationAction;
  intent: Intent;
  confidence: 'high' | 'low';
  nextState: ConversationState;
  // Porque é que esta mensagem foi tratada assim. Vai para o histórico da conversa —
  // uma decisão automática sobre a comunicação de uma clínica tem de ser auditável.
  reason: string;
  // Sugestão de urgência para a tarefa criada, quando há uma.
  urgent: boolean;
}

// `channel` é obrigatório e não tem valor por omissão de propósito: é ele que decide se
// alguma resposta automática é sequer possível, e um default silencioso nesse tipo de
// decisão é como se abrem buracos. Mesma regra do `public?: true` em lib/route.ts —
// o comportamento permissivo exige escrever a palavra.
export function routeInbound(
  text: unknown,
  autonomy: AutonomyLevel,
  channel: ConversationChannel,
  currentState: ConversationState = 'awaiting_staff',
): RoutingDecision {
  const { intent, confidence, matched } = classifyIntent(text);

  // Regra 2: sempre, antes de tudo.
  if (intent === 'stop') {
    return {
      action: 'process_optout',
      intent,
      confidence,
      nextState: 'resolved',
      reason: `Pedido de não contacto ("${matched[0]}"). Registado imediatamente, independentemente do nível de autonomia — é retirada de consentimento.`,
      urgent: false,
    };
  }

  // Regra 1: o software não interpreta sintomas.
  if (intent === 'clinical') {
    return {
      action: 'escalate',
      intent,
      confidence,
      nextState: 'escalated',
      reason: `Assunto clínico ("${matched.slice(0, 3).join('", "')}"). Escalado para uma pessoa sem resposta automática — o software não tria sintomas nem tranquiliza ninguém.`,
      urgent: true,
    };
  }

  // Numa chamada, o caminho acaba aqui: classifica-se, e vai para quem vai ligar de
  // volta. Ver allowsAutoReply acima — responder a uma chamada é falar.
  if (!allowsAutoReply(channel)) {
    return {
      action: 'human_task',
      intent,
      confidence,
      nextState: stateAfterInbound(currentState),
      reason: `${INTENT_LABELS[intent]} por ${CHANNEL_LABELS[channel]}. Uma chamada é sempre devolvida por uma pessoa.`,
      urgent: false,
    };
  }

  const scope = AUTONOMY_SCOPE[autonomy] || AUTONOMY_SCOPE.off;

  if (scope.has(intent) && confidence === 'high') {
    return {
      action: 'auto_reply',
      intent,
      confidence,
      // Uma resposta automática não fecha a conversa: fica à espera do doente, e se ele
      // insistir volta para a caixa de entrada de uma pessoa. Marcar como resolvida
      // seria o software a declarar que resolveu uma coisa que não sabe se resolveu.
      nextState: 'awaiting_patient',
      reason: `${INTENT_LABELS[intent]} — dentro do que o nível "${AUTONOMY_LABELS[autonomy]}" autoriza responder sozinho.`,
      urgent: false,
    };
  }

  if (autonomy !== 'off') {
    return {
      action: 'auto_acknowledge',
      intent,
      confidence,
      nextState: 'awaiting_staff',
      reason:
        confidence === 'low'
          ? `${INTENT_LABELS[intent]}, mas sem certeza suficiente para responder sozinho. Acusa a receção e espera por uma pessoa.`
          : `${INTENT_LABELS[intent]} está fora do que o nível "${AUTONOMY_LABELS[autonomy]}" autoriza. Acusa a receção e espera por uma pessoa.`,
      urgent: false,
    };
  }

  return {
    action: 'human_task',
    intent,
    confidence,
    nextState: stateAfterInbound(currentState),
    reason: `${INTENT_LABELS[intent]}. Autonomia desligada — vai inteira para uma pessoa.`,
    urgent: false,
  };
}

// ─── 5. Escalamento com contexto ────────────────────────────────────────────
// Quando um humano entra, entra a meio. O que faz a diferença entre uma passagem útil
// e uma inútil não é o texto da última mensagem — é o resumo de quem é a pessoa, o que
// já lhe foi dito automaticamente, e o que está pendente. É a mesma ideia da passagem
// de turno (lib/shiftHandoffCalc.ts): quem chega tem de saber o que se passou sem ter
// de reconstruir.
export interface EscalationContext {
  patientName: string | null;
  channel: ConversationChannel;
  intent: Intent;
  messageCount: number;
  autoRepliesSent: number;
  lastInboundText: string;
  journeyStage?: string | null;
  nextAppointment?: string | null;
  openItems?: string[];
}

export function buildEscalationBrief(ctx: EscalationContext): string {
  const linhas: string[] = [];
  linhas.push(
    `${ctx.patientName || 'Contacto não identificado'} · ${CHANNEL_LABELS[ctx.channel]} · ${INTENT_LABELS[ctx.intent]}`,
  );
  linhas.push(`Última mensagem: "${ctx.lastInboundText.slice(0, 200)}"`);
  if (ctx.nextAppointment) linhas.push(`Próxima consulta: ${ctx.nextAppointment}`);
  if (ctx.journeyStage) linhas.push(`Etapa: ${ctx.journeyStage}`);
  if (ctx.openItems?.length) linhas.push(`Pendentes: ${ctx.openItems.join('; ')}`);
  linhas.push(
    ctx.autoRepliesSent > 0
      ? `Já foram enviadas ${ctx.autoRepliesSent} respostas automáticas nesta conversa (${ctx.messageCount} mensagens no total) — ler o fio antes de responder.`
      : `Nenhuma resposta automática foi enviada (${ctx.messageCount} mensagens no total).`,
  );
  return linhas.join('\n');
}

// Uma conversa esquecida é pior do que uma conversa não atendida: o doente já sabe que
// a mensagem chegou. Isto é o que o job de varredura usa para as encontrar.
export const STALE_AWAITING_STAFF_HOURS = 4;
export const STALE_ESCALATED_HOURS = 1;

export function isStale(state: ConversationState, hoursSinceLastMessage: number): boolean {
  if (state === 'escalated') return hoursSinceLastMessage >= STALE_ESCALATED_HOURS;
  if (state === 'awaiting_staff') return hoursSinceLastMessage >= STALE_AWAITING_STAFF_HOURS;
  return false;
}
