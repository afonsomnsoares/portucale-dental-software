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

export type OptimizerMoveKind =
  | 'gap_fill'
  | 'unassigned_dentist'
  | 'equipment_block'
  | 'preference_mismatch'
  // As três seguintes raciocinam sobre duas ou mais consultas em conjunto — ver o
  // bloco "Raciocínio sobre DUAS OU MAIS consultas" no fim deste ficheiro.
  | 'group_visit'
  | 'pull_forward'
  | 'consolidate';

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
  // Propostas que envolvem mais do que uma consulta (agrupar, consolidar) listam-nas
  // todas aqui; `appointmentId` continua a apontar para a que teria de ser mexida.
  appointmentIds?: string[];
  // Dias que a consulta se antecipa (regra 6). Não é capacidade recuperada — é tempo
  // até ao tratamento, e por isso vive num campo próprio em vez de inflacionar
  // gainMinutes.
  advanceDays?: number;
  // Minutos mortos que deixam de estar no meio do dia (regra 7). Também não são
  // capacidade nova: são capacidade mudada para um sítio onde se consegue usar.
  consolidatedMinutes?: number;
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
    // Entre propostas sem ganho de capacidade, as que mexem em tempo (antecipar,
    // consolidar) vêm à frente das que só corrigem a qualidade da marcação — senão
    // as regras 6 e 7 ficariam para sempre no fundo da lista, atrás de quatro
    // avisos de preferência, e ninguém as veria.
    const secondaryA = (a.advanceDays || 0) + (a.consolidatedMinutes || 0);
    const secondaryB = (b.advanceDays || 0) + (b.consolidatedMinutes || 0);
    if (secondaryA !== secondaryB) return secondaryB - secondaryA;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });
}

// ═══ Raciocínio sobre DUAS OU MAIS consultas ════════════════════════════════
// As quatro regras acima olham para uma consulta de cada vez: este buraco, esta
// consulta sem dentista, esta cadeira bloqueada, esta preferência violada. Faltava
// o passo seguinte — agrupar, antecipar e combinar — que é onde uma agenda deixa de
// ser uma lista de compromissos e passa a ser um plano.
//
// As três regras abaixo continuam a propor e nunca a aplicar, pela mesma razão de
// sempre: cada uma delas implica ligar ao doente.

// Minutos que se perdem em cada visita além do tratamento em si — receber, sentar,
// preparar a cadeira, desinfetar no fim. É o que se poupa de facto ao juntar duas
// consultas numa, e é por isso a unidade de ganho da regra 5.
//
// Dez minutos é uma estimativa conservadora e explícita, não uma medição: o projeto
// não regista tempos de rotação (a agenda guarda `duration`, não o que aconteceu
// dentro dela). Preferiu-se um número redondo que se possa discutir a uma média
// falsamente precisa calculada a partir de dados que não existem.
export const TURNAROUND_MINUTES = 10;

export interface PatientAppointments {
  patientId: string;
  patientName: string;
  appointments: Booking[];
}

// ─── Regra 5: agrupar consultas do mesmo doente ─────────────────────────────
// Duas ou mais consultas do mesmo doente em dias diferentes, dentro de uma janela
// curta, e cuja soma cabe numa sessão só. Vale a pena juntar por três motivos, e o
// terceiro é o que costuma esquecer-se: poupa tempo de cadeira à clínica, poupa uma
// deslocação ao doente, e REMOVE UMA OPORTUNIDADE DE FALTAR. Duas consultas são duas
// hipóteses de não aparecer; uma é uma.
//
// `maxSessionMinutes` existe porque a regra tem um limite óbvio: ninguém quer três
// horas seguidas na cadeira, e uma sessão longa demais é ela própria um motivo para
// desmarcar. O chamador decide o limite (ver lib/scheduleOptimizer.ts).
//
// Não junta consultas com dentistas diferentes: seriam duas sessões coladas e não uma,
// e a poupança de rotação desaparece. Junta as que estão por atribuir com as que já
// têm dentista, porque essas ainda podem ser atribuídas ao mesmo.
export function buildGroupVisitMoves(
  patients: PatientAppointments[],
  windowDays: number,
  maxSessionMinutes: number,
): OptimizerMove[] {
  const moves: OptimizerMove[] = [];

  for (const p of patients) {
    const sorted = [...p.appointments].sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startMinutes - b.startMinutes,
    );
    // Só consultas em DIAS diferentes: duas no mesmo dia não são um agrupamento, são
    // uma questão de adjacência, e essa é a regra 7.
    const byDay = new Map<string, Booking[]>();
    for (const b of sorted) {
      const day = byDay.get(b.date) || [];
      day.push(b);
      byDay.set(b.date, day);
    }
    const days = Array.from(byDay.keys()).sort();
    if (days.length < 2) continue;

    // Janela deslizante sobre os dias, gulosa a partir do primeiro: o agrupamento
    // ancora-se sempre na consulta mais próxima, porque antecipar é preferível a
    // adiar — juntar no dia de trás obriga a adiar o que já estava marcado.
    let i = 0;
    while (i < days.length) {
      const anchorDay = days[i];
      const group: Booking[] = [...(byDay.get(anchorDay) as Booking[])];
      let j = i + 1;
      while (j < days.length) {
        const gapDays = Math.round(
          (Date.parse(`${days[j]}T00:00:00Z`) - Date.parse(`${anchorDay}T00:00:00Z`)) / 86_400_000,
        );
        if (gapDays > windowDays) break;
        const extra = byDay.get(days[j]) as Booking[];
        const total = [...group, ...extra].reduce((sum, b) => sum + b.durationMinutes, 0);
        if (total > maxSessionMinutes) break;
        // Dentistas diferentes não se juntam — ver o cabeçalho.
        const dentists = new Set([...group, ...extra].map((b) => b.dentistId).filter(Boolean));
        if (dentists.size > 1) break;
        group.push(...extra);
        j += 1;
      }

      const visitsMerged = new Set(group.map((b) => b.date)).size;
      if (visitsMerged >= 2) {
        const totalMinutes = group.reduce((sum, b) => sum + b.durationMinutes, 0);
        const types = Array.from(new Set(group.map((b) => b.type)));
        moves.push({
          kind: 'group_visit',
          key: `group_visit:${p.patientId}:${anchorDay}`,
          title: `${p.patientName} · ${visitsMerged} consultas em ${visitsMerged} dias`,
          detail: `${types.join(' + ')} — ${group
            .map((b) => `${b.date} (${b.durationMinutes} min)`)
            .join(', ')}. Cabem numa sessão de ${totalMinutes} min a partir de ${anchorDay}: poupa ${
            (visitsMerged - 1) * TURNAROUND_MINUTES
          } min de rotação, uma deslocação ao doente e ${visitsMerged - 1} ${
            visitsMerged - 1 === 1 ? 'oportunidade' : 'oportunidades'
          } de faltar.`,
          gainMinutes: (visitsMerged - 1) * TURNAROUND_MINUTES,
          patientName: p.patientName,
          date: anchorDay,
          appointmentIds: group.map((b) => b.appointmentId),
        });
      }
      i = Math.max(j, i + 1);
    }
  }
  return moves;
}

// ─── Regra 6: antecipar consultas ───────────────────────────────────────────
// Uma consulta marcada para daqui a muito tempo, e um espaço livre mais cedo onde ela
// cabe. Antecipar não muda a ocupação total — troca um lugar por outro — por isso
// gainMinutes é 0 e o ganho declara-se em DIAS. Vale por três razões concretas, todas
// já medidas noutro sítio deste projeto:
//
//   • o prazo de marcação é ele próprio um fator de risco de falta
//     (leadTimeFactor em lib/noShowRisk.ts sobe até aos 21 dias) — antecipar
//     reduz o risco da consulta que se antecipa;
//   • receita mais cedo é receita mais provável: entre hoje e daqui a seis semanas
//     cabe uma mudança de ideias, uma mudança de clínica e um plano esquecido;
//   • o lugar que se liberta no fim fica disponível para procura que ainda nem
//     entrou — que é sempre mais fácil de preencher do que um buraco para amanhã.
//
// Só propõe antecipações com ganho material (`minAdvanceDays`): mover uma consulta um
// dia para trás é incomodar o doente por nada.
export interface PullForwardCandidate {
  booking: Booking;
  // Espaço mais cedo onde a consulta cabe inteira, já filtrado pelo chamador contra
  // as preferências do doente e a disponibilidade do dentista.
  target: Opening;
}

export function buildPullForwardMoves(
  candidates: PullForwardCandidate[],
  formatTime: (minutes: number) => string,
  minAdvanceDays = 3,
): OptimizerMove[] {
  const moves: OptimizerMove[] = [];
  const seen = new Set<string>();

  // Maior antecipação primeiro, e cada consulta e cada espaço usados uma só vez: sem
  // isto a mesma consulta apareceria proposta para cinco espaços diferentes e o mesmo
  // espaço prometido a cinco consultas — a mesma armadilha de contagem dupla que o
  // comentário de buildGapFillMoves descreve.
  const usedOpenings = new Set<string>();
  const ordered = [...candidates].sort((a, b) => {
    const da = advanceDays(a);
    const db = advanceDays(b);
    return db !== da ? db - da : a.booking.appointmentId < b.booking.appointmentId ? -1 : 1;
  });

  for (const c of ordered) {
    const days = advanceDays(c);
    if (days < minAdvanceDays) continue;
    if (seen.has(c.booking.appointmentId)) continue;
    const openingKey = `${c.target.date}:${c.target.chair}:${c.target.startMinutes}`;
    if (usedOpenings.has(openingKey)) continue;
    if (c.target.durationMinutes < c.booking.durationMinutes) continue;

    seen.add(c.booking.appointmentId);
    usedOpenings.add(openingKey);
    moves.push({
      kind: 'pull_forward',
      key: `pull_forward:${c.booking.appointmentId}`,
      title: `${c.booking.patientName} · ${c.booking.type}`,
      detail: `Marcada para ${c.booking.date}; há espaço a ${c.target.date} às ${formatTime(
        c.target.startMinutes,
      )} na cadeira ${c.target.chair}. Antecipar ${days} dias reduz o risco de falta (o prazo de marcação é um dos fatores) e liberta o lugar de ${c.booking.date}.`,
      gainMinutes: 0,
      advanceDays: days,
      appointmentId: c.booking.appointmentId,
      patientName: c.booking.patientName,
      date: c.booking.date,
    });
  }
  return moves;
}

function advanceDays(c: PullForwardCandidate): number {
  return Math.round(
    (Date.parse(`${c.booking.date}T00:00:00Z`) - Date.parse(`${c.target.date}T00:00:00Z`)) / 86_400_000,
  );
}

// ─── Regra 7: combinar consultas do mesmo dia ───────────────────────────────
// Duas consultas no mesmo dia com um buraco entre elas. Colá-las não muda quanto
// tempo de cadeira se usa — muda ONDE fica o tempo livre: em vez de trinta minutos
// mortos no meio da manhã, fica um bloco contíguo na ponta, que é o único tipo de
// espaço que se consegue vender a uma consulta inteira.
//
// É a operação inversa de buildGapFillMoves: aquela procura quem meter no buraco,
// esta faz o buraco desaparecer quando não há ninguém para lá meter. Por isso o
// chamador só deve aplicar esta regra aos espaços que a regra 1 não conseguiu
// preencher — caso contrário as duas propõem coisas contraditórias sobre o mesmo
// espaço no mesmo ecrã.
//
// Aplica-se a consultas do mesmo doente OU do mesmo agregado (o chamador decide o
// que é "mesmo agregado" — hoje, mesmo apelido e mesmo telefone; ver
// lib/scheduleOptimizer.ts). Duas consultas de estranhos também se podem colar, mas
// isso é remarcar alguém sem lhe dar nada em troca, e não é o que esta regra propõe.
export interface SameDayPair {
  first: Booking;
  second: Booking;
  // 'patient' quando é a mesma pessoa, 'household' quando são pessoas diferentes do
  // mesmo agregado — muda o texto da proposta, porque um telefonema a uma família é
  // uma conversa diferente de um telefonema a uma pessoa.
  relation: 'patient' | 'household';
}

export function buildConsolidateMoves(
  pairs: SameDayPair[],
  formatTime: (minutes: number) => string,
  minGapMinutes = 20,
): OptimizerMove[] {
  const moves: OptimizerMove[] = [];
  const seen = new Set<string>();

  for (const { first, second, relation } of pairs) {
    if (first.date !== second.date) continue;
    const [a, b] = first.startMinutes <= second.startMinutes ? [first, second] : [second, first];
    const gap = b.startMinutes - (a.startMinutes + a.durationMinutes);
    if (gap < minGapMinutes) continue;

    // Uma consulta só participa numa proposta de consolidação — encadear várias
    // mudanças no mesmo dia é uma remarcação em cascata, não uma sugestão.
    if (seen.has(a.appointmentId) || seen.has(b.appointmentId)) continue;
    seen.add(a.appointmentId);
    seen.add(b.appointmentId);

    const quem =
      relation === 'patient'
        ? `${a.patientName} tem duas consultas`
        : `${a.patientName} e ${b.patientName} têm consultas`;
    moves.push({
      kind: 'consolidate',
      key: `consolidate:${a.appointmentId}:${b.appointmentId}`,
      title: `${a.patientName} · ${a.date}`,
      detail: `${quem} no mesmo dia com ${gap} min mortos entre elas (${formatTime(
        a.startMinutes + a.durationMinutes,
      )}–${formatTime(b.startMinutes)}). Encostar a segunda à primeira junta esse tempo ao bloco livre do fim do dia, onde cabe uma consulta inteira.`,
      // O tempo não é criado — é mudado de sítio. Contá-lo como ganho de capacidade
      // faria a soma do otimizador crescer sem que a clínica pudesse marcar mais
      // nada, que é exatamente a inflação que buildGapFillMoves evita ao alocar cada
      // doente uma só vez.
      gainMinutes: 0,
      consolidatedMinutes: gap,
      appointmentId: b.appointmentId,
      patientName: a.patientName,
      date: a.date,
      appointmentIds: [a.appointmentId, b.appointmentId],
    });
  }
  return moves;
}
