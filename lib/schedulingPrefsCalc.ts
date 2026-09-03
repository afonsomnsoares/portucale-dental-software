// Puro — sem imports de DB, testável como lib/waitlistMatch.ts, com quem partilha
// o vocabulário (dias preferidos, janela horária, dentista preferido). A diferença
// de fundo está aqui: waitlistMatch.matchesSlot FILTRA (um candidato que não
// encaixa não recebe a oferta), enquanto isto PONTUA.
//
// Item 9 pede as preferências do paciente como sinal de otimização, não como
// regra. Uma preferência dura tornaria impossível marcar um doente que "só pode
// de manhã" numa urgência à tarde, o que seria pior do que não ter preferências
// nenhumas. Aqui uma preferência violada faz o horário descer na lista e ficar
// assinalado — nunca desaparecer.

export interface SchedulingPreferences {
  preferredDentistId: string | null;
  preferredDays: number[] | null; // 0=Domingo .. 6=Sábado; null/[] = qualquer dia
  preferredTimeStart: string | null; // 'HH:MM' ou null = qualquer hora
  preferredTimeEnd: string | null;
}

export interface PreferenceCandidate {
  date: string; // 'YYYY-MM-DD'
  startMinutes: number;
  durationMinutes: number;
  dentistId: string | null;
}

export const WEEKDAY_LABEL_PT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function hasAnyPreference(prefs: SchedulingPreferences | null | undefined): boolean {
  if (!prefs) return false;
  return !!(
    prefs.preferredDentistId ||
    prefs.preferredDays?.length ||
    prefs.preferredTimeStart ||
    prefs.preferredTimeEnd
  );
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + (m || 0);
}

// Dia da semana em UTC a partir de 'YYYY-MM-DD' — a data é um dia de calendário
// puro, sem hora, por isso interpretá-la em UTC evita que um fuso à frente/atrás
// a empurre para o dia anterior. Mesma razão do 'T00:00:00Z' em
// lib/waitlistMatch.ts.
export function weekdayOfDate(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export interface PreferenceFit {
  // 0..3 — quantos dos critérios definidos pelo doente o horário respeita.
  score: number;
  // Quantos critérios o doente definiu. Um horário com score 2 de 2 respeita
  // tudo; 2 de 3 não. Sem isto não se distingue "perfeito" de "incompleto".
  applicable: number;
  // Frases prontas para a UI, só para o que foi violado.
  violations: string[];
  // Respeita tudo o que o doente pediu (ou o doente não pediu nada).
  satisfied: boolean;
}

// Três critérios independentes — dia, janela horária, dentista. Cada um só conta
// se o doente o tiver definido, para um doente com uma única preferência não ser
// penalizado face a um que definiu três.
export function preferenceFit(
  prefs: SchedulingPreferences | null | undefined,
  candidate: PreferenceCandidate,
): PreferenceFit {
  if (!prefs || !hasAnyPreference(prefs)) {
    return { score: 0, applicable: 0, violations: [], satisfied: true };
  }

  let score = 0;
  let applicable = 0;
  const violations: string[] = [];

  if (prefs.preferredDays?.length) {
    applicable += 1;
    const weekday = weekdayOfDate(candidate.date);
    if (prefs.preferredDays.includes(weekday)) {
      score += 1;
    } else {
      violations.push(
        `${WEEKDAY_LABEL_PT[weekday]} não está nos dias preferidos (${prefs.preferredDays
          .map((d) => WEEKDAY_LABEL_PT[d])
          .join(', ')})`,
      );
    }
  }

  if (prefs.preferredTimeStart || prefs.preferredTimeEnd) {
    applicable += 1;
    const start = candidate.startMinutes;
    const end = start + candidate.durationMinutes;
    const prefStart = prefs.preferredTimeStart ? toMinutes(prefs.preferredTimeStart) : 0;
    const prefEnd = prefs.preferredTimeEnd ? toMinutes(prefs.preferredTimeEnd) : 24 * 60;
    // A consulta tem de caber INTEIRA na janela — igual a waitlistMatch.matchesSlot.
    // Começar dentro e acabar fora não serve a quem tem de sair a uma certa hora.
    if (start >= prefStart && end <= prefEnd) {
      score += 1;
    } else {
      violations.push(
        `Fora da janela horária preferida (${prefs.preferredTimeStart || '00:00'}–${prefs.preferredTimeEnd || '24:00'})`,
      );
    }
  }

  if (prefs.preferredDentistId) {
    applicable += 1;
    if (candidate.dentistId && candidate.dentistId === prefs.preferredDentistId) {
      score += 1;
    } else {
      violations.push('Não é o dentista preferido');
    }
  }

  return { score, applicable, violations, satisfied: violations.length === 0 };
}

// Resumo legível do perfil, para cartões e avisos. '' quando não há preferências
// — o chamador decide se mostra "sem preferências" ou nada.
export function describePreferences(
  prefs: SchedulingPreferences | null | undefined,
  dentistName?: string | null,
): string {
  if (!hasAnyPreference(prefs) || !prefs) return '';
  const parts: string[] = [];
  if (prefs.preferredDays?.length) {
    parts.push(prefs.preferredDays.map((d) => WEEKDAY_LABEL_PT[d]).join(', '));
  }
  if (prefs.preferredTimeStart || prefs.preferredTimeEnd) {
    parts.push(`${prefs.preferredTimeStart || '00:00'}–${prefs.preferredTimeEnd || '24:00'}`);
  }
  if (prefs.preferredDentistId) {
    parts.push(dentistName ? `com ${dentistName}` : 'dentista específico');
  }
  return parts.join(' · ');
}
