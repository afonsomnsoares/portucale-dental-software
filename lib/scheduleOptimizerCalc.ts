// Puro — sem imports de DB, testável como lib/scheduleIntelCalc.ts.
//
// lib/scheduleIntelCalc.ts's suggestCapacityMoves já diz "a cadeira 2 está
// subutilizada". Isso é um diagnóstico, não um movimento: quem lê ainda tem de
// descobrir sozinho O QUÊ mover, PARA ONDE e QUANDO. O item 9 pede a otimização
// de "dentista + cadeira + paciente + horário", e é isso que este ficheiro
// produz — propostas concretas, cada uma com a consulta (ou o doente) em causa,
// o destino e os minutos que se ganham.
//
// Nada aqui altera a agenda. Todas as propostas são para uma pessoa aprovar —
// mover uma consulta implica avisar o doente, o que o software não pode decidir
// sozinho.

export interface Booking {
  appointmentId: string;
  chair: number;
  date: string; // 'YYYY-MM-DD'
  startMinutes: number;
  durationMinutes: number;
  dentistId: string | null;
  patientId: string | null;
  patientName: string;
  type: string;
}

export interface ChairDayWindow {
  // Janela de funcionamento da clínica nesse dia, em minutos desde a meia-noite.
  openMinutes: number;
  closeMinutes: number;
}

export interface Opening {
  chair: number;
  date: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  // Um buraco ENTRE duas consultas é pior do que uma ponta livre no início ou no
  // fim do dia: a ponta ainda pode ser preenchida alargando o dia, o buraco é
  // capacidade morta no meio do horário. A UI ordena por isto.
  kind: 'gap' | 'edge';
}

// Espaços livres numa cadeira-dia. Reconstrói a informação que
// computeAgendaEfficiency calcula e deita fora — ela soma gapMinutes/gapCount
// para uma métrica agregada, aqui interessa saber ONDE estão.
//
// As consultas podem chegar por qualquer ordem e podem sobrepor-se (marcação
// manual em cadeiras diferentes é impossível, mas dados históricos não são
// garantidamente limpos), por isso os intervalos são fundidos antes de se
// procurarem os espaços.
export function findOpenings(bookings: Booking[], window: ChairDayWindow, minDurationMinutes = 15): Opening[] {
  if (!bookings.length) return [];
  const chair = bookings[0].chair;
  const date = bookings[0].date;

  const intervals = bookings
    .map((b) => ({ start: b.startMinutes, end: b.startMinutes + b.durationMinutes }))
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }

  const openings: Opening[] = [];
  const push = (start: number, end: number, kind: Opening['kind']) => {
    const duration = end - start;
    if (duration >= minDurationMinutes) {
      openings.push({ chair, date, startMinutes: start, endMinutes: end, durationMinutes: duration, kind });
    }
  };

  push(window.openMinutes, Math.min(merged[0].start, window.closeMinutes), 'edge');
  for (let i = 1; i < merged.length; i++) {
    push(merged[i - 1].end, merged[i].start, 'gap');
  }
  push(Math.max(merged[merged.length - 1].end, window.openMinutes), window.closeMinutes, 'edge');

  return openings.filter((o) => o.durationMinutes >= minDurationMinutes);
}

export type OptimizerMoveKind = 'gap_fill' | 'unassigned_dentist' | 'equipment_block' | 'preference_mismatch';

export interface OptimizerMove {
  kind: OptimizerMoveKind;
  // Chave estável para o React e para deduplicação — sem ids aleatórios, para a
  // mesma agenda produzir sempre as mesmas chaves.
  key: string;
  title: string;
  detail: string;
  // Minutos de capacidade que a proposta recupera. 0 quando a proposta melhora a
  // qualidade da marcação sem alterar a ocupação (dentista em falta, preferência
  // violada) — a UI só soma os que têm ganho real.
  gainMinutes: number;
  appointmentId?: string;
  patientName?: string;
  date?: string;
}

export interface WaitlistFit {
  waitlistEntryId: string;
  patientName: string;
  treatmentType: string;
  minDuration: number;
}

export interface OpeningWaitlistCandidate {
  preferredDays: number[] | null;
  preferredTimeStart: string | null;
  preferredTimeEnd: string | null;
  minDuration: number;
  maxWaitUntil: string | null;
  status: string;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

// Deliberadamente NÃO é lib/waitlistMatch.ts's matchesSlot, apesar de parecer o
// mesmo problema. Aquela função responde a "esta vaga que acabou de ser
// libertada serve a este candidato?" e por isso compara o tipo de tratamento da
// consulta cancelada e o dentista que a ia fazer. Um espaço vazio na agenda não
// tem nem uma coisa nem outra: não é uma consulta cancelada, é ausência de
// consulta. Comparar contra um tipo inexistente rejeitaria toda a gente, e
// comparar contra um dentista inexistente rejeitaria justamente quem tem uma
// preferência de dentista — o oposto do pretendido.
//
// Sobra o que é mesmo verificável num espaço vazio: duração, dia da semana,
// janela horária e prazo máximo de espera.
export function waitlistFitsOpening(candidate: OpeningWaitlistCandidate, opening: Opening, today: string): boolean {
  if (candidate.status !== 'active') return false;
  if (candidate.minDuration > opening.durationMinutes) return false;
  if (opening.date < today) return false;
  if (candidate.maxWaitUntil && opening.date > candidate.maxWaitUntil) return false;

  const weekday = new Date(`${opening.date}T00:00:00Z`).getUTCDay();
  if (candidate.preferredDays?.length && !candidate.preferredDays.includes(weekday)) return false;

  if (candidate.preferredTimeStart || candidate.preferredTimeEnd) {
    const prefStart = candidate.preferredTimeStart ? toMinutes(candidate.preferredTimeStart) : 0;
    const prefEnd = candidate.preferredTimeEnd ? toMinutes(candidate.preferredTimeEnd) : 24 * 60;
    // Basta que a consulta CAIBA algures dentro da janela preferida — ao
    // contrário de uma vaga concreta, aqui a hora de início ainda é negociável
    // dentro do espaço livre.
    const overlapStart = Math.max(opening.startMinutes, prefStart);
    const overlapEnd = Math.min(opening.endMinutes, prefEnd);
    if (overlapEnd - overlapStart < candidate.minDuration) return false;
  }

  return true;
}

// ─── Regra 1: encaixar a lista de espera nos buracos ────────────────────────
// O sinal mais valioso: um espaço concreto e um doente concreto que lá cabe.
//
// A alocação é EXCLUSIVA e gulosa, e isso é o ponto todo desta função. A versão
// óbvia — para cada buraco, listar quem lá cabe — conta o mesmo doente em todos
// os buracos onde ele encaixa e produz um total de capacidade recuperável
// absurdo: uma clínica com um doente em lista de espera e a agenda vazia
// "recuperaria" semanas de tempo, quando na realidade só pode recuperar a
// duração daquele tratamento. Aqui cada entrada da lista é atribuída no máximo
// uma vez, e o ganho de cada proposta é o tempo que os doentes atribuídos
// ocupam de facto — nunca o tamanho do buraco.
//
// Ordem de preenchimento: buracos entre consultas primeiro (capacidade morta no
// meio do dia, o pior tipo), depois os mais antigos. `fits` é injetado pelo
// chamador para a regra de compatibilidade viver num só sítio.
export function buildGapFillMoves(
  openings: Opening[],
  candidates: WaitlistFit[],
  fits: (candidate: WaitlistFit, opening: Opening) => boolean,
  formatTime: (minutes: number) => string,
): OptimizerMove[] {
  const ordered = [...openings].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'gap' ? -1 : 1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return a.chair - b.chair;
  });

  const taken = new Set<string>();
  const moves: OptimizerMove[] = [];

  for (const o of ordered) {
    let remaining = o.durationMinutes;
    const assigned: WaitlistFit[] = [];
    for (const c of candidates) {
      if (taken.has(c.waitlistEntryId)) continue;
      if (c.minDuration > remaining) continue;
      if (!fits(c, o)) continue;
      assigned.push(c);
      taken.add(c.waitlistEntryId);
      remaining -= c.minDuration;
    }
    if (!assigned.length) continue;

    const usedMinutes = o.durationMinutes - remaining;
    const names = assigned.slice(0, 3).map((f) => f.patientName);
    moves.push({
      kind: 'gap_fill',
      key: `gap_fill:${o.date}:${o.chair}:${o.startMinutes}`,
      title: `Cadeira ${o.chair} · ${o.date} · ${formatTime(o.startMinutes)}–${formatTime(o.endMinutes)}`,
      detail: `${o.durationMinutes} min ${o.kind === 'gap' ? 'vazios entre consultas' : 'livres na ponta do dia'} — encaixa ${names.join(', ')}${assigned.length > names.length ? ` (+${assigned.length - names.length})` : ''} da lista de espera (${usedMinutes} min).`,
      gainMinutes: usedMinutes,
      date: o.date,
    });
  }
  return moves;
}

// ─── Regra 2: consultas sem dentista atribuído ──────────────────────────────
// "otimizar: dentista + cadeira + paciente + horário" — uma consulta com
// dentist_id NULL não tem sequer o primeiro dos quatro. Não conta como ganho de
// capacidade (a cadeira já está ocupada), mas é uma marcação incompleta que
// alguém tem de fechar.
export function buildUnassignedDentistMoves(
  bookings: Booking[],
  suggestFor: (b: Booking) => { dentistId: string; dentistName: string; utilizationPct: number } | null,
): OptimizerMove[] {
  const moves: OptimizerMove[] = [];
  for (const b of bookings) {
    if (b.dentistId) continue;
    const pick = suggestFor(b);
    moves.push({
      kind: 'unassigned_dentist',
      key: `unassigned_dentist:${b.appointmentId}`,
      title: `${b.patientName} · ${b.date} · ${b.type}`,
      detail: pick
        ? `Consulta sem dentista atribuído — ${pick.dentistName} está disponível e é quem tem menos agenda ocupada (${pick.utilizationPct}%).`
        : 'Consulta sem dentista atribuído e nenhum dentista livre nesse horário — é preciso remarcar ou abrir turno.',
      gainMinutes: 0,
      appointmentId: b.appointmentId,
      patientName: b.patientName,
      date: b.date,
    });
  }
  return moves;
}

// ─── Regra 3: cadeira equipada ocupada sem necessidade ──────────────────────
// Só faz sentido quando o equipamento é escasso: se todas as cadeiras o tiverem,
// não há nada a libertar. O chamador decide o que é "escasso" (ver
// lib/scheduleOptimizer.ts) — aqui só se aplica a regra.
export function buildEquipmentBlockMoves(
  bookings: Booking[],
  isBlockingScarceChair: (b: Booking) => { tags: string[]; alternativeChair: number } | null,
): OptimizerMove[] {
  const moves: OptimizerMove[] = [];
  for (const b of bookings) {
    const blocking = isBlockingScarceChair(b);
    if (!blocking) continue;
    moves.push({
      kind: 'equipment_block',
      key: `equipment_block:${b.appointmentId}`,
      title: `${b.patientName} · ${b.date} · cadeira ${b.chair}`,
      detail: `"${b.type}" não precisa de ${blocking.tags.join(', ')}, mas ocupa a única cadeira que o tem. Mover para a cadeira ${blocking.alternativeChair} liberta-a para tratamentos que o exijam.`,
      gainMinutes: b.durationMinutes,
      appointmentId: b.appointmentId,
      patientName: b.patientName,
      date: b.date,
    });
  }
  return moves;
}

// ─── Regra 4: consulta marcada contra as preferências do doente ─────────────
// Item 9 — "preferências dos pacientes" aplicadas ao que JÁ está marcado, e não
// só ao que se vai marcar. Uma consulta assim é um candidato natural a falta:
// foi marcada num dia/hora que o doente tinha dito que lhe dava jeito evitar.
export function buildPreferenceMismatchMoves(
  bookings: Booking[],
  violationsFor: (b: Booking) => string[],
): OptimizerMove[] {
  const moves: OptimizerMove[] = [];
  for (const b of bookings) {
    const violations = violationsFor(b);
    if (!violations.length) continue;
    moves.push({
      kind: 'preference_mismatch',
      key: `preference_mismatch:${b.appointmentId}`,
      title: `${b.patientName} · ${b.date}`,
      detail: `Marcação fora das preferências do doente: ${violations.join('; ')}. Confirmar ou propor alternativa reduz o risco de falta.`,
      gainMinutes: 0,
      appointmentId: b.appointmentId,
      patientName: b.patientName,
      date: b.date,
    });
  }
  return moves;
}

// Maior ganho de capacidade primeiro; entre iguais, os que recuperam tempo antes
// dos que só melhoram a qualidade; depois por data e por chave, para a ordem ser
// estável entre execuções.
export function rankMoves(moves: OptimizerMove[]): OptimizerMove[] {
  return [...moves].sort((a, b) => {
    if (a.gainMinutes !== b.gainMinutes) return b.gainMinutes - a.gainMinutes;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });
}
