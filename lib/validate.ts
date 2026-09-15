export function isUuid(v: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
}

export function asString(v: unknown, { trim = true, max = 2000 }: { trim?: boolean; max?: number } = {}) {
  if (v === undefined || v === null) return null;
  let s = String(v);
  if (trim) s = s.trim();
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}

export function asInt(v: unknown, { min, max }: { min?: number; max?: number } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const int = Math.trunc(n);
  if (int !== n) return null;
  if (min !== undefined && int < min) return null;
  if (max !== undefined && int > max) return null;
  return int;
}

export function asDate(v: unknown) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function asTime(v: unknown) {
  if (!v) return null;
  const s = String(v).slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : null;
}

export function asEmail(v: unknown) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

// Twilio (SMS) requires E.164 (leading '+' and country code). Patient phones are stored
// as plain PT digits (9-digit mobile, no country code) — assume '351' when it's missing
// so numbers don't silently fail to send. Numbers already carrying a country code pass
// through untouched. Returns '' when there's nothing usable.
//
// ─── O prefixo de marcação internacional não é parte do número ──────────────
// '00' é como se marca para fora a partir de Portugal, e é como muita gente escreve
// um número internacional num formulário. Não pertence ao E.164 — o '+' ocupa
// exatamente esse lugar — mas como só se olhava para o comprimento, '00351912345678'
// saía daqui como '+00351912345678': um número que a Twilio recusa, numa mensagem que
// alguém contava que fosse enviada. Descartar o '00' antes de decidir é o que põe as
// duas escritas do mesmo número a dar no mesmo sítio.
export function toE164(v: unknown) {
  let digits = String(v || '').replace(/[^\d]/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return '';
  if (digits.length === 9) return `+351${digits}`;
  return `+${digits}`;
}

export function asEnum(v: unknown, values: readonly string[]) {
  if (!v || !Array.isArray(values)) return null;
  const s = String(v).trim();
  return values.includes(s) ? s : null;
}

export function asFee(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 999999.99 ? Math.round(n * 100) / 100 : null;
}

export function requireFields(obj: Record<string, unknown> | null | undefined, fields: readonly string[]) {
  const missing: string[] = [];
  for (const f of fields) {
    const v = obj?.[f];
    if (v === undefined || v === null || v === '') missing.push(f);
  }
  return missing;
}

type BodyRecord = Record<string, unknown>;

/**
 * Os limites que o servidor aplica, num sítio só e exportados.
 *
 * Existem porque os formulários os tinham escritos à mão e mais frouxos do que isto:
 * o modal de consulta punha `min={5}` sem `max` nenhum enquanto o servidor recusa
 * acima de 480, e o de doente não tinha `<form>` à volta, por isso o `type="email"`
 * nunca chegava a validar. O pedido ia à API, voltava recusado, e a pessoa via a
 * mensagem do servidor — em inglês, numa interface em português.
 *
 * Com os limites aqui, o formulário e a rota não podem divergir: mudar um número
 * muda os dois lados.
 */
export const LIMITES = {
  duracaoMin: 5,
  duracaoMax: 480,
  cadeiraMin: 1,
  cadeiraMax: 99,
  nome: 200,
  tipo: 100,
  telefone: 30,
  seguro: 100,
} as const;

export function validateAppointmentBody(body: BodyRecord) {
  const errors: string[] = [];
  if (body.date && !asDate(body.date)) errors.push('Data inválida (formato AAAA-MM-DD).');
  if (body.startTime && !asTime(body.startTime)) errors.push('Hora inválida (formato HH:MM).');
  if (
    body.duration !== undefined &&
    asInt(body.duration, { min: LIMITES.duracaoMin, max: LIMITES.duracaoMax }) === null
  )
    errors.push(`A duração tem de estar entre ${LIMITES.duracaoMin} e ${LIMITES.duracaoMax} minutos.`);
  if (body.chair !== undefined && asInt(body.chair, { min: LIMITES.cadeiraMin, max: LIMITES.cadeiraMax }) === null)
    errors.push(`A cadeira tem de estar entre ${LIMITES.cadeiraMin} e ${LIMITES.cadeiraMax}.`);
  if (body.type && String(body.type).length > LIMITES.tipo)
    errors.push(`O tipo de consulta não pode ter mais de ${LIMITES.tipo} caracteres.`);
  if (body.patientName && String(body.patientName).length > LIMITES.nome)
    errors.push(`O nome do doente não pode ter mais de ${LIMITES.nome} caracteres.`);
  return errors.length ? errors : null;
}

export function validatePatientBody(body: BodyRecord) {
  const errors: string[] = [];
  if (!body.name || String(body.name).trim().length < 1) errors.push('O nome é obrigatório.');
  if (String(body.name || '').length > LIMITES.nome)
    errors.push(`O nome não pode ter mais de ${LIMITES.nome} caracteres.`);
  if (body.dob && !asDate(body.dob)) errors.push('Data de nascimento inválida (formato AAAA-MM-DD).');
  if (body.email && !asEmail(body.email)) errors.push('O e-mail não parece válido.');
  if (body.phone && String(body.phone).length > LIMITES.telefone)
    errors.push(`O telefone não pode ter mais de ${LIMITES.telefone} caracteres.`);
  if (body.insurance && String(body.insurance).length > LIMITES.seguro)
    errors.push(`O seguro não pode ter mais de ${LIMITES.seguro} caracteres.`);
  return errors.length ? errors : null;
}

export function validateTreatmentBody(body: BodyRecord) {
  const errors: string[] = [];
  if (!body.patientId) errors.push('É preciso indicar o doente.');
  if (!body.description || String(body.description).trim().length < 1) errors.push('A descrição é obrigatória.');
  if (body.fee !== undefined && asFee(body.fee) === null) errors.push('O valor cobrado não é válido.');
  return errors.length ? errors : null;
}

export function sanitizeString(v: unknown, max = 2000) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}
