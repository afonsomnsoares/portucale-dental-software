import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowsAutoReply,
  AUTONOMY_LEVELS,
  canActOnSchedule,
  buildEscalationBrief,
  canTransition,
  classifyIntent,
  CONVERSATION_CHANNELS,
  CONVERSATION_STATES,
  DEFAULT_AUTONOMY,
  isAutonomyLevel,
  isConversationChannel,
  isStale,
  normalize,
  routeInbound,
  writesToSchedule,
  STALE_AWAITING_STAFF_HOURS,
  STALE_ESCALATED_HOURS,
  stateAfterInbound,
} from '../lib/conversationCalc.ts';

test('normalize tira acentos, pontuação e maiúsculas', () => {
  assert.equal(normalize('NÃO Enviem, por favor!'), 'nao enviem por favor');
  assert.equal(normalize('  Olá   '), 'ola');
  assert.equal(normalize(null), '');
});

test('os canais e níveis são validados e não adivinhados', () => {
  assert.ok(isConversationChannel('sms'));
  assert.ok(isConversationChannel('voice'));
  assert.equal(isConversationChannel('whatsapp'), false, 'saiu com a migração 052');
  assert.equal(isConversationChannel('email'), false, 'saiu com a migração 052');
  assert.equal(isConversationChannel('pombo'), false);
  assert.ok(isAutonomyLevel(DEFAULT_AUTONOMY));
  assert.equal(isAutonomyLevel('total'), false);
});

// A decisão de produto que ainda não foi tomada tem de ter o valor de repouso seguro.
test('o valor de repouso da autonomia é desligado', () => {
  assert.equal(DEFAULT_AUTONOMY, 'off');
  assert.equal(AUTONOMY_LEVELS[0], 'off');
});

// ─── Máquina de estados ─────────────────────────────────────────────────────

test('as transições válidas estão fechadas', () => {
  assert.ok(canTransition('awaiting_staff', 'resolved'));
  assert.ok(canTransition('awaiting_patient', 'awaiting_staff'));
  assert.equal(canTransition('closed', 'awaiting_staff'), false, 'o arquivo é o arquivo');
  assert.equal(canTransition('escalated', 'awaiting_staff'), false, 'uma conversa escalada fica marcada');
});

test('uma mensagem nova reabre a conversa, exceto no arquivo', () => {
  assert.equal(stateAfterInbound('resolved'), 'awaiting_staff');
  assert.equal(stateAfterInbound('awaiting_patient'), 'awaiting_staff');
  assert.equal(stateAfterInbound('escalated'), 'escalated', 'não desescala sozinha');
  assert.equal(stateAfterInbound('closed'), 'closed');
});

test('todos os estados declarados têm transições definidas', () => {
  for (const s of CONVERSATION_STATES) {
    assert.doesNotThrow(() => canTransition(s, 'closed'));
  }
});

// ─── Regra 2: retirada de consentimento ─────────────────────────────────────

test('o pedido de não contacto é reconhecido em várias formas', () => {
  for (const texto of ['STOP', 'Não quero receber mais mensagens', 'nao me contactem', 'unsubscribe']) {
    assert.equal(classifyIntent(texto).intent, 'stop', `"${texto}" devia ser opt-out`);
  }
});

// A armadilha: 'stop' como subcadeia dentro de uma frase clínica.
test('"não consigo parar de sangrar" não é um opt-out', () => {
  const r = classifyIntent('nao consigo parar de sangrar');
  assert.notEqual(r.intent, 'stop');
  assert.equal(r.intent, 'clinical');
});

test('o opt-out é processado com a autonomia desligada', () => {
  const d = routeInbound('STOP', 'off', 'sms');
  assert.equal(d.action, 'process_optout');
  assert.match(d.reason, /retirada de consentimento/);
});

test('o opt-out é processado com a autonomia no máximo', () => {
  assert.equal(routeInbound('STOP', 'transactional', 'sms').action, 'process_optout');
});

// ─── Regra 1: nada clínico é respondido ─────────────────────────────────────

test('qualquer sintoma escala, em qualquer nível de autonomia', () => {
  for (const nivel of AUTONOMY_LEVELS) {
    const d = routeInbound('Tenho muitas dores no dente do siso', nivel, 'sms');
    assert.equal(d.action, 'escalate', `com autonomia "${nivel}" devia escalar`);
    assert.equal(d.urgent, true);
    assert.equal(d.nextState, 'escalated');
  }
});

// O caso que separa "o que a pessoa pede" de "o que importa".
test('uma remarcação por causa de dor é tratada como dor', () => {
  const r = classifyIntent('tenho o dente partido, posso remarcar para amanha?');
  assert.equal(r.intent, 'clinical');
  assert.equal(routeInbound('tenho o dente partido, posso remarcar para amanha?', 'transactional', 'sms').action, 'escalate');
});

test('vários sintomas na mesma mensagem aparecem na justificação', () => {
  const d = routeInbound('tenho dor e febre e esta inchado', 'off', 'sms');
  assert.match(d.reason, /dor/);
});

// ─── Intenções administrativas ──────────────────────────────────────────────

test('cancelar, remarcar e marcar distinguem-se', () => {
  assert.equal(classifyIntent('quero cancelar a consulta de quinta').intent, 'cancel');
  assert.equal(classifyIntent('podem mudar a consulta para a semana seguinte?').intent, 'reschedule');
  assert.equal(classifyIntent('gostava de marcar uma consulta').intent, 'book');
});

test('quem quer remarcar não é tratado como quem quer cancelar', () => {
  assert.equal(classifyIntent('preciso de remarcar').intent, 'reschedule');
});

test('horários e morada são perguntas de facto', () => {
  assert.equal(classifyIntent('ate que horas estao abertos?').intent, 'hours');
  assert.equal(classifyIntent('qual e a morada da clinica?').intent, 'location');
});

test('preços são cobrados como assunto financeiro, não respondidos', () => {
  assert.equal(classifyIntent('quanto custa um implante?').intent, 'billing');
});

test('"sim" sozinho é confirmação; "sim, mas quanto custa" não é', () => {
  assert.equal(classifyIntent('sim').intent, 'confirm');
  assert.equal(classifyIntent('confirmo').intent, 'confirm');
  assert.equal(classifyIntent('sim, mas quanto custa?').intent, 'billing');
});

test('uma mensagem sem nada reconhecível é "other" com confiança baixa', () => {
  const r = classifyIntent('bom dia');
  assert.equal(r.intent, 'other');
  assert.equal(r.confidence, 'low');
});

test('uma expressão de várias palavras dá mais confiança do que uma palavra solta', () => {
  assert.equal(classifyIntent('nao vou poder ir a consulta').confidence, 'high');
  assert.equal(classifyIntent('consulta').confidence, 'low');
});

// ─── A escada de autonomia ──────────────────────────────────────────────────

test('com a autonomia desligada tudo vai para uma pessoa', () => {
  const d = routeInbound('ate que horas estao abertos?', 'off', 'sms');
  assert.equal(d.action, 'human_task');
});

test('"acknowledge" acusa a receção e não responde a nada', () => {
  assert.equal(routeInbound('ate que horas estao abertos?', 'acknowledge', 'sms').action, 'auto_acknowledge');
});

test('"informational" responde a factos verificáveis', () => {
  assert.equal(routeInbound('ate que horas estao abertos?', 'informational', 'sms').action, 'auto_reply');
  assert.equal(routeInbound('qual e a morada da clinica?', 'informational', 'sms').action, 'auto_reply');
});

// Nunca, em nenhum degrau.
test('preços nunca são respondidos automaticamente', () => {
  for (const nivel of AUTONOMY_LEVELS) {
    assert.notEqual(routeInbound('quanto custa um implante?', nivel, 'sms').action, 'auto_reply', `nível ${nivel}`);
  }
});

test('"informational" ainda não cancela nem remarca', () => {
  assert.equal(routeInbound('quero cancelar a consulta de quinta', 'informational', 'sms').action, 'auto_acknowledge');
});

test('"transactional" já trata confirmações e cancelamentos', () => {
  assert.equal(routeInbound('confirmo', 'transactional', 'sms').action, 'auto_reply');
  assert.equal(routeInbound('quero cancelar a consulta de quinta', 'transactional', 'sms').action, 'auto_reply');
});

test('uma classificação de confiança baixa nunca é respondida sozinha', () => {
  const d = routeInbound('consulta', 'transactional', 'sms');
  assert.equal(d.confidence, 'low');
  assert.equal(d.action, 'auto_acknowledge');
});

test('uma resposta automática não declara a conversa resolvida', () => {
  const d = routeInbound('ate que horas estao abertos?', 'informational', 'sms');
  assert.equal(d.nextState, 'awaiting_patient', 'o software não sabe se resolveu');
});

// ─── Escalamento com contexto ───────────────────────────────────────────────

test('o resumo de escalamento traz quem, o quê e o que já foi dito', () => {
  const brief = buildEscalationBrief({
    patientName: 'Ana Ribeiro',
    channel: 'voice',
    intent: 'clinical',
    messageCount: 4,
    autoRepliesSent: 2,
    lastInboundText: 'Tenho muitas dores desde ontem',
    journeyStage: 'Tratamento',
    nextAppointment: '2026-03-12 09:30',
    openItems: ['Plano por aceitar (1 200 €)'],
  });
  assert.match(brief, /Ana Ribeiro/);
  assert.match(brief, /Chamada/);
  assert.match(brief, /Tenho muitas dores/);
  assert.match(brief, /2026-03-12/);
  assert.match(brief, /Plano por aceitar/);
  assert.match(brief, /2 respostas automáticas/);
});

test('um contacto não identificado ainda produz um resumo utilizável', () => {
  const brief = buildEscalationBrief({
    patientName: null,
    channel: 'sms',
    intent: 'book',
    messageCount: 1,
    autoRepliesSent: 0,
    lastInboundText: 'queria marcar',
  });
  assert.match(brief, /Contacto não identificado/);
  assert.match(brief, /Nenhuma resposta automática/);
});

test('o resumo corta mensagens muito longas', () => {
  const brief = buildEscalationBrief({
    patientName: 'X',
    channel: 'sms',
    intent: 'other',
    messageCount: 1,
    autoRepliesSent: 0,
    lastInboundText: 'a'.repeat(500),
  });
  assert.ok(brief.length < 500);
});

// ─── Conversas esquecidas ───────────────────────────────────────────────────

test('uma conversa escalada fica velha muito mais depressa', () => {
  assert.ok(STALE_ESCALATED_HOURS < STALE_AWAITING_STAFF_HOURS);
  assert.equal(isStale('escalated', STALE_ESCALATED_HOURS), true);
  assert.equal(isStale('awaiting_staff', STALE_ESCALATED_HOURS), false);
  assert.equal(isStale('awaiting_staff', STALE_AWAITING_STAFF_HOURS), true);
});

test('o que espera pelo doente nunca é uma conversa esquecida nossa', () => {
  assert.equal(isStale('awaiting_patient', 999), false);
  assert.equal(isStale('resolved', 999), false);
});

// ═══ Dois canais: SMS e chamada ════════════════════════════════════════════
// Decisão de produto (migração 052): o agente fala por SMS e atende chamadas. Nada de
// WhatsApp, nada de e-mail.

test('só existem dois canais, e são estes', () => {
  assert.deepEqual([...CONVERSATION_CHANNELS], ['sms', 'voice']);
});

// Responder a uma chamada é falar, e falar é uma pessoa.
test('uma chamada nunca recebe resposta automática, em nenhum degrau', () => {
  assert.equal(allowsAutoReply('voice'), false);
  assert.equal(allowsAutoReply('sms'), true);

  for (const nivel of AUTONOMY_LEVELS) {
    const d = routeInbound('ate que horas estao abertos?', nivel, 'voice');
    assert.equal(d.action, 'human_task', `com autonomia "${nivel}" uma chamada devia ir para uma pessoa`);
  }
});

test('a mesma pergunta por SMS é respondida e por chamada não', () => {
  assert.equal(routeInbound('qual e a morada da clinica?', 'informational', 'sms').action, 'auto_reply');
  assert.equal(routeInbound('qual e a morada da clinica?', 'informational', 'voice').action, 'human_task');
});

// As duas regras de segurança continuam acima do canal.
test('um assunto clínico dito ao telefone escala na mesma', () => {
  const d = routeInbound('tenho muitas dores', 'transactional', 'voice');
  assert.equal(d.action, 'escalate');
  assert.equal(d.urgent, true);
});

test('um pedido de não contacto por chamada é processado na mesma', () => {
  assert.equal(routeInbound('nao me contactem mais', 'off', 'voice').action, 'process_optout');
});

test('a justificação de uma chamada diz que é devolvida por uma pessoa', () => {
  const d = routeInbound('quero marcar uma consulta', 'transactional', 'voice');
  assert.match(d.reason, /Chamada/);
  assert.match(d.reason, /pessoa/);
});

// ─── O degrau 'agenda' (migração 062) ───────────────────────────────────────
// O degrau que escreve. A diferença face a 'transactional' não está em que intenções
// trata — está em que ali a resposta é a ação, e aqui a ação acontece mesmo.

const AGENDA = { upcomingAppointmentCount: 1, confidence: 'high' as const, hasPendingOffer: false };

test("só o degrau 'agenda' escreve na agenda", () => {
  assert.equal(writesToSchedule('agenda'), true);
  for (const nivel of AUTONOMY_LEVELS.filter((l) => l !== 'agenda')) {
    assert.equal(writesToSchedule(nivel), false, `${nivel} não pode escrever`);
  }
});

test('um pedido de cancelamento com uma só consulta marcada cancela-a', () => {
  const d = routeInbound('não vou poder ir, cancelem por favor', 'agenda', 'sms', 'awaiting_staff', AGENDA);
  assert.equal(d.action, 'cancel_appointment');
});

// A regra é a ambiguidade, não a confiança no modelo: com duas consultas marcadas,
// escolher qual cancelar é escolher pelo doente.
test('com duas consultas marcadas, o cancelamento vai para uma pessoa', () => {
  const d = routeInbound('não vou poder ir, cancelem por favor', 'agenda', 'sms', 'awaiting_staff', {
    ...AGENDA,
    upcomingAppointmentCount: 2,
  });
  assert.equal(d.action, 'human_task');
  assert.match(d.reason, /2 consultas/);
});

// Descoberto a escrever os testes acima, e vale a pena ficar escrito: «cancelem a
// consulta» classifica como 'book' com confiança baixa, porque «consulta» pesa mais do
// que «cancelem» em classifyIntent. Não é perigoso — confiança baixa nunca age, e o
// caminho acaba numa tarefa para uma pessoa — mas é uma fraqueza real da classificação
// por palavras-chave, e este teste existe para que ela não passe a ser perigosa em
// silêncio no dia em que alguém mexer nos pesos.
test('uma frase ambígua nunca chega a escrever na agenda', () => {
  const d = routeInbound('cancelem a consulta', 'agenda', 'sms', 'awaiting_staff', AGENDA);
  assert.notEqual(d.action, 'cancel_appointment');
  assert.equal(d.confidence, 'low');
});

test('sem consulta marcada não há nada a cancelar', () => {
  const d = routeInbound('quero cancelar', 'agenda', 'sms', 'awaiting_staff', {
    ...AGENDA,
    upcomingAppointmentCount: 0,
  });
  assert.equal(d.action, 'human_task');
});

// O mesmo texto, um degrau abaixo: responde e não mexe em nada. É a garantia de que
// ligar o degrau novo é uma decisão, e não um efeito de atualizar o código.
test("no degrau 'transactional' o mesmo pedido não cancela nada", () => {
  const d = routeInbound('não vou poder ir, cancelem', 'transactional', 'sms', 'awaiting_staff', AGENDA);
  assert.equal(d.action, 'auto_reply');
});

test('um pedido de marcação passa a propor um lugar concreto', () => {
  const d = routeInbound('queria marcar uma consulta', 'agenda', 'sms', 'awaiting_staff', {
    ...AGENDA,
    upcomingAppointmentCount: 0,
  });
  assert.equal(d.action, 'offer_slot');
  assert.equal(d.nextState, 'awaiting_patient');
});

// «Sim» significa coisas diferentes consoante o que a clínica perguntou por último.
test('um SIM com oferta pendente aceita a oferta, e sem ela confirma a consulta', () => {
  const comOferta = routeInbound('sim', 'agenda', 'sms', 'awaiting_patient', { ...AGENDA, hasPendingOffer: true });
  assert.equal(comOferta.action, 'accept_offer');

  const semOferta = routeInbound('sim', 'agenda', 'sms', 'awaiting_patient', AGENDA);
  assert.equal(semOferta.action, 'auto_reply');
});

// As duas fronteiras que nenhum degrau atravessa continuam intactas.
test('nem o degrau da agenda toca no clínico nem ignora um STOP', () => {
  assert.equal(routeInbound('dói-me muito o dente', 'agenda', 'sms', 'awaiting_staff', AGENDA).action, 'escalate');
  assert.equal(routeInbound('não enviem mais mensagens', 'agenda', 'sms', 'awaiting_staff', AGENDA).action, 'process_optout');
});

// Uma chamada nunca chega a escrever na agenda: responder a uma chamada é falar.
test('por voz, o degrau da agenda continua a devolver para uma pessoa', () => {
  const d = routeInbound('quero cancelar', 'agenda', 'voice', 'awaiting_staff', AGENDA);
  assert.equal(d.action, 'human_task');
});

test('canActOnSchedule exige certeza e uma consulta só', () => {
  assert.equal(canActOnSchedule({ upcomingAppointmentCount: 1, confidence: 'high' }).ok, true);
  assert.equal(canActOnSchedule({ upcomingAppointmentCount: 1, confidence: 'low' }).ok, false);
  assert.equal(canActOnSchedule({ upcomingAppointmentCount: 0, confidence: 'high' }).ok, false);
  assert.equal(canActOnSchedule({ upcomingAppointmentCount: 3, confidence: 'high' }).ok, false);
});

// ─── Um SIM a uma oferta da lista de espera ─────────────────────────────────
// Não é a confirmação de uma consulta: não há consulta nenhuma, há um lugar oferecido.
// Antes, nos degraus 'transactional' e 'agenda', o doente recebia «a sua consulta fica
// confirmada» e nada ficava marcado.
test('lista de espera: no degrau agenda, um SIM com uma só oferta pendente aceita-a', () => {
  const ctx = { upcomingAppointmentCount: 0, confidence: 'high' as const, hasPendingOffer: false };
  assert.equal(routeInbound('sim', 'agenda', 'sms', 'awaiting_patient', ctx, 1).action, 'accept_offer');
});

test('lista de espera: com duas ofertas pendentes o SIM é ambíguo e vai para uma pessoa', () => {
  const ctx = { upcomingAppointmentCount: 0, confidence: 'high' as const, hasPendingOffer: false };
  const d = routeInbound('sim', 'agenda', 'sms', 'awaiting_patient', ctx, 2);
  assert.equal(d.action, 'auto_acknowledge');
  assert.match(d.reason, /não se sabe qual/);
});

test('lista de espera: abaixo do degrau agenda nunca responde «fica confirmada»', () => {
  for (const nivel of ['informational', 'transactional'] as const) {
    assert.equal(routeInbound('sim', nivel, 'sms', 'awaiting_patient', undefined, 1).action, 'auto_acknowledge', nivel);
  }
  assert.equal(routeInbound('sim', 'off', 'sms', 'awaiting_patient', undefined, 1).action, 'human_task');
  // Sem oferta nenhuma, o SIM continua a ser a confirmação de sempre.
  assert.equal(routeInbound('sim', 'transactional', 'sms', 'awaiting_patient', undefined, 0).action, 'auto_reply');
});
