// Puro — sem imports de DB, testável como lib/staffAvailabilityCalc.ts, de onde
// reutiliza o formato ScheduleBlock. Item 11 — "handoffs": a passagem de turno.

import type { ScheduleBlock } from './staffAvailabilityCalc';

export type ShiftLabel = 'morning' | 'afternoon' | 'evening' | 'other';

export const SHIFT_LABELS: readonly ShiftLabel[] = ['morning', 'afternoon', 'evening', 'other'] as const;

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

// Classifica um bloco de turno pela hora a que COMEÇA, não pela hora a que se está.
// Uma pessoa que entra às 8h e sai às 14h fez o turno da manhã, mesmo que a
// passagem seja escrita às 14h05. Os cortes (13h/18h) são os habituais numa
// clínica portuguesa com almoço pelo meio.
export function shiftLabelForBlock(block: ScheduleBlock | null | undefined): ShiftLabel {
  if (!block) return 'other';
  const start = toMinutes(block.startTime);
  if (start < 13 * 60) return 'morning';
  if (start < 18 * 60) return 'afternoon';
  return 'evening';
}

// O bloco de hoje que `at` está a terminar (ou dentro do qual está). Devolve o
// bloco cujo fim esteja mais próximo à frente de `at`; se já saiu de todos,
// devolve o último que terminou. null quando não há turno nenhum nesse dia.
export function currentOrLastBlock(blocks: ScheduleBlock[], at: Date): ScheduleBlock | null {
  const weekday = at.getDay();
  const minutes = at.getHours() * 60 + at.getMinutes();
  const today = blocks.filter((b) => b.weekday === weekday);
  if (!today.length) return null;

  const ongoing = today
    .filter((b) => minutes >= toMinutes(b.startTime) && minutes < toMinutes(b.endTime))
    .sort((a, b) => toMinutes(a.endTime) - toMinutes(b.endTime));
  if (ongoing.length) return ongoing[0];

  const ended = today
    .filter((b) => toMinutes(b.endTime) <= minutes)
    .sort((a, b) => toMinutes(b.endTime) - toMinutes(a.endTime));
  return ended[0] || null;
}

// "Estás quase a sair, deixa a passagem." True dentro dos últimos
// `windowMinutes` de um bloco de turno, ou até `windowMinutes` depois de ele ter
// acabado — a janela estende-se para depois do fim de propósito, porque quem
// escreve a passagem raramente o faz antes da hora de saída.
export function isNearShiftEnd(blocks: ScheduleBlock[], at: Date, windowMinutes = 60): boolean {
  const weekday = at.getDay();
  const minutes = at.getHours() * 60 + at.getMinutes();
  return blocks.some((b) => {
    if (b.weekday !== weekday) return false;
    const end = toMinutes(b.endTime);
    return minutes >= end - windowMinutes && minutes <= end + windowMinutes;
  });
}

export interface HandoffSignals {
  openTasks: Array<{ title: string; patientName?: string | null; overdue?: boolean }>;
  openIncidents: Array<{ title: string; severity: string }>;
  unfinishedChecklists: Array<{ name: string }>;
  patientsInClinic: Array<{ name: string; status: string }>;
  pendingWaitlistOffers: number;
}

const PATIENT_STATUS_LABEL: Record<string, string> = {
  waiting: 'em sala de espera',
  'in-operatory': 'em gabinete',
  'ready-dismissal': 'pronto para sair',
};

// Transforma o estado real da clínica nas linhas que aparecem pré-preenchidas na
// passagem de turno. Devolve texto, não estruturas: uma passagem de turno é o que
// ficou escrito naquele momento e é guardada congelada (ver
// 031_task_routing_handoffs.sql), por isso não faz sentido guardar referências
// que amanhã apontam para outro estado.
export function buildHandoffItems(signals: HandoffSignals): string[] {
  const items: string[] = [];

  for (const p of signals.patientsInClinic) {
    items.push(`Doente na clínica: ${p.name} (${PATIENT_STATUS_LABEL[p.status] || p.status})`);
  }
  for (const t of signals.openTasks) {
    const who = t.patientName ? ` — ${t.patientName}` : '';
    items.push(`Tarefa ${t.overdue ? 'ATRASADA' : 'aberta'}: ${t.title}${who}`);
  }
  for (const i of signals.openIncidents) {
    items.push(`Incidente ${i.severity} por resolver: ${i.title}`);
  }
  for (const c of signals.unfinishedChecklists) {
    items.push(`Checklist por concluir: ${c.name}`);
  }
  if (signals.pendingWaitlistOffers > 0) {
    items.push(`${signals.pendingWaitlistOffers} oferta(s) de vaga à espera de resposta`);
  }

  return items;
}
