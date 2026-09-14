import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asDate,
  asEmail,
  asEnum,
  asFee,
  asInt,
  asString,
  asTime,
  isUuid,
  requireFields,
  sanitizeString,
  toE164,
  validateAppointmentBody,
  validatePatientBody,
  validateTreatmentBody,
} from '../lib/validate.ts';

// ─── Porque é que este ficheiro existe ──────────────────────────────────────
// `lib/validate.ts` é a fronteira por onde entra tudo o que vem de fora: o corpo
// de cada POST, o `?from=` de cada relatório, o formulário do portal do doente —
// a única superfície onde alguém sem sessão escreve. É puro, não toca na base de
// dados e não tem dependências, e mesmo assim era dos poucos módulos de lib/ sem
// um único teste.
//
// O que se testa aqui não é «a função devolve o que devolve». É a distinção que
// cada uma tem de manter e que um refactor distraído apaga sem falhar nada: entre
// ausente e inválido, entre truncar e recusar, entre um número que a Twilio aceita
// e um que ela recusa.

test('isUuid: aceita o que o Postgres produz e recusa o que ele nunca produziria', () => {
  // gen_random_uuid() é v4: dígito de versão '4' e variante em [89ab].
  assert.equal(isUuid('f47ac10b-58cc-4372-a567-0e02b2c3d479'), true);
  assert.equal(isUuid('F47AC10B-58CC-4372-A567-0E02B2C3D479'), true, 'maiúsculas são o mesmo UUID');

  assert.equal(isUuid('f47ac10b-58cc-0372-a567-0e02b2c3d479'), false, 'versão 0 não existe');
  assert.equal(isUuid('f47ac10b-58cc-4372-c567-0e02b2c3d479'), false, 'variante fora de [89ab]');
  assert.equal(isUuid('f47ac10b58cc4372a5670e02b2c3d479'), false, 'sem hífenes');
  assert.equal(isUuid('f47ac10b-58cc-4372-a567-0e02b2c3d47'), false, 'curto de um dígito');
  assert.equal(isUuid(`f47ac10b-58cc-4372-a567-0e02b2c3d479 OR 1=1`), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(undefined), false);
});

test('asString: distingue ausente de vazio, e trunca em vez de recusar', () => {
  assert.equal(asString(undefined), null, 'ausente é null, não ""');
  assert.equal(asString(null), null);
  assert.equal(asString('  olá  '), 'olá');
  assert.equal(asString('  olá  ', { trim: false }), '  olá  ');
  // Truncar é a decisão tomada — um texto longo de mais entra cortado, não recusado.
  // Fica fixado porque é o tipo de coisa que se inverte por acidente.
  assert.equal(asString('abcdef', { max: 3 }), 'abc');
  assert.equal(asString(123), '123');
});

test('asInt: recusa o que não é inteiro em vez de arredondar', () => {
  assert.equal(asInt('42'), 42);
  assert.equal(asInt(42), 42);
  assert.equal(asInt(42.5), null, 'um decimal é recusado, não truncado');
  assert.equal(asInt('abc'), null);
  assert.equal(asInt(Number.NaN), null);
  assert.equal(asInt(Number.POSITIVE_INFINITY), null);
  assert.equal(asInt(5, { min: 10 }), null);
  assert.equal(asInt(50, { max: 10 }), null);
  assert.equal(asInt(10, { min: 10, max: 10 }), 10, 'os limites são inclusivos');
});

test('asDate: só a forma YYYY-MM-DD, e nada que se lhe pareça', () => {
  assert.equal(asDate('2026-09-13'), '2026-09-13');
  assert.equal(asDate('2026-09-13T10:30:00Z'), '2026-09-13', 'um ISO completo é cortado na data');
  assert.equal(asDate('13-09-2026'), null);
  assert.equal(asDate('2026/09/13'), null);
  assert.equal(asDate(''), null);
  assert.equal(asDate(null), null);
});

test('asTime: 24 horas, e as horas que não existem ficam de fora', () => {
  assert.equal(asTime('09:30'), '09:30');
  assert.equal(asTime('23:59'), '23:59');
  assert.equal(asTime('00:00'), '00:00');
  assert.equal(asTime('24:00'), null);
  assert.equal(asTime('09:60'), null);
  assert.equal(asTime('9:30'), null, 'sem zero à esquerda não é a forma esperada');
  assert.equal(asTime('09:30:45'), '09:30', 'os segundos são cortados');
});

test('asEmail: normaliza como quem insere, para as duas pontas concordarem', () => {
  // A mesma função corre no login e no INSERT (ver app/api/auth/login/route.ts): se
  // deixasse de normalizar aqui, uma maiúscula passava a devolver 401 com a password
  // certa. É a razão pela qual o trim e o lowercase são parte do contrato.
  assert.equal(asEmail('  Ana@Clinica.PT '), 'ana@clinica.pt');
  assert.equal(asEmail('sem-arroba'), null);
  assert.equal(asEmail('a@b'), null, 'sem ponto no domínio');
  assert.equal(asEmail('a b@c.pt'), null, 'espaços não passam');
  assert.equal(asEmail(''), null);
  assert.equal(asEmail(null), null);
});

test('toE164: as várias formas de escrever o mesmo número dão no mesmo sítio', () => {
  assert.equal(toE164('912345678'), '+351912345678', 'nacional a nove dígitos ganha o indicativo');
  assert.equal(toE164('912 345 678'), '+351912345678', 'espaços não contam');
  assert.equal(toE164('+351 912 345 678'), '+351912345678');
  assert.equal(toE164('351912345678'), '+351912345678');

  // A correção: '00' é o prefixo de marcação internacional, não parte do número. Sem
  // isto saía '+00351912345678', que a Twilio recusa — uma mensagem que alguém contava
  // que fosse enviada e não foi.
  assert.equal(toE164('00351912345678'), '+351912345678', "o '00' de marcação é descartado");
  assert.equal(toE164('00 351 912 345 678'), '+351912345678');
  assert.equal(toE164('0034600000000'), '+34600000000', 'e vale para qualquer país, não só o 351');

  assert.equal(toE164(''), '');
  assert.equal(toE164(null), '');
  assert.equal(toE164('sem dígitos nenhuns'), '');
  assert.equal(toE164('00'), '', "só o prefixo não é número nenhum");
});

test('asEnum: a lista branca é a lista, e o input não a alarga', () => {
  const valores = ['proposed', 'accepted', 'done'] as const;
  assert.equal(asEnum('accepted', valores), 'accepted');
  assert.equal(asEnum('  accepted  ', valores), 'accepted');
  assert.equal(asEnum('ACCEPTED', valores), null, 'a comparação é sensível a maiúsculas');
  assert.equal(asEnum('deleted', valores), null);
  assert.equal(asEnum('', valores), null);
  assert.equal(asEnum('toString', valores), null, 'propriedades do protótipo não são valores');
});

test('asFee: dinheiro com dois decimais, sem negativos e com teto', () => {
  assert.equal(asFee(120), 120);
  assert.equal(asFee('120.50'), 120.5);
  assert.equal(asFee(120.555), 120.56, 'arredonda aos cêntimos');
  assert.equal(asFee(0), 0, 'gratuito é um valor válido, não uma ausência');
  assert.equal(asFee(-1), null);
  assert.equal(asFee(1_000_000), null);
  assert.equal(asFee('abc'), null);
  assert.equal(asFee(Number.NaN), null);
});

test('requireFields: string vazia conta como em falta', () => {
  assert.deepEqual(requireFields({ a: 1, b: 'x' }, ['a', 'b']), []);
  assert.deepEqual(requireFields({ a: 1 }, ['a', 'b']), ['b']);
  assert.deepEqual(requireFields({ a: '' }, ['a']), ['a'], "'' é ausência, não valor");
  assert.deepEqual(requireFields({ a: null }, ['a']), ['a']);
  assert.deepEqual(requireFields({ a: 0 }, ['a']), [], '0 é um valor');
  assert.deepEqual(requireFields({ a: false }, ['a']), [], 'false é um valor');
  assert.deepEqual(requireFields(null, ['a']), ['a'], 'corpo ausente não rebenta');
});

test('validateAppointmentBody: devolve null quando está bom, e a lista quando não', () => {
  assert.equal(validateAppointmentBody({ date: '2026-09-13', startTime: '09:30', duration: 30, chair: 2 }), null);
  assert.equal(validateAppointmentBody({}), null, 'um corpo vazio é para o handler decidir, não para aqui');

  const erros = validateAppointmentBody({ date: '13-09-2026', startTime: '25:00', duration: 3, chair: 0 });
  assert.ok(erros && erros.length === 4, 'os quatro problemas são reportados de uma vez, não um de cada vez');

  assert.ok(validateAppointmentBody({ duration: 480 }) === null, '480 é o máximo, inclusive');
  assert.ok(validateAppointmentBody({ duration: 481 }));
  assert.ok(validateAppointmentBody({ type: 'x'.repeat(101) }));
  assert.ok(validateAppointmentBody({ patientName: 'x'.repeat(201) }));
});

test('validatePatientBody: o nome é o único obrigatório', () => {
  assert.equal(validatePatientBody({ name: 'Ana' }), null);
  assert.ok(validatePatientBody({}), 'sem nome não passa');
  assert.ok(validatePatientBody({ name: '   ' }), 'só espaços é o mesmo que nada');
  assert.ok(validatePatientBody({ name: 'Ana', email: 'não-é-email' }));
  assert.ok(validatePatientBody({ name: 'Ana', dob: '01/01/1990' }));
  assert.equal(validatePatientBody({ name: 'Ana', email: 'ana@clinica.pt', dob: '1990-01-01' }), null);
});

test('validateTreatmentBody: doente e descrição, e a taxa só se vier', () => {
  assert.equal(validateTreatmentBody({ patientId: 'p1', description: 'Destartarização' }), null);
  assert.ok(validateTreatmentBody({ description: 'x' }), 'sem patientId não passa');
  assert.ok(validateTreatmentBody({ patientId: 'p1' }), 'sem descrição não passa');
  assert.ok(validateTreatmentBody({ patientId: 'p1', description: 'x', fee: -5 }));
  assert.equal(validateTreatmentBody({ patientId: 'p1', description: 'x', fee: 0 }), null, 'zero é uma taxa válida');
});

test('sanitizeString: devolve sempre uma string, ao contrário do asString', () => {
  // A diferença entre os dois é o ponto: `asString` distingue ausente (null) de vazio,
  // `sanitizeString` colapsa tudo em string porque quem o chama vai gravar o valor.
  assert.equal(sanitizeString(undefined), '');
  assert.equal(sanitizeString(null), '');
  assert.equal(sanitizeString('  olá  '), 'olá');
  assert.equal(sanitizeString('abcdef', 3), 'abc');
  assert.equal(sanitizeString(0), '0', 'zero não é ausência');
});
