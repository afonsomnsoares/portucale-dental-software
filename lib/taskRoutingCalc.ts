// Puro — sem imports de DB, testável como lib/staffAvailabilityCalc.ts. Decide
// QUEM deve ficar com uma tarefa; lib/taskRouting.ts trata de ir buscar os
// candidatos e a carga de cada um.
//
// Item 11 — "distribuição de tarefas": patient_tasks já tinha `assigned_to`
// desde 018, mas nada o preenchia. Todas as tarefas criadas pelos jobs nasciam
// na fila partilhada (assigned_to NULL) à espera que alguém reparasse nelas.

// Todos os tipos de patient_tasks (ver 018_patient_tasks.sql) são, por
// natureza, trabalho de receção: ligar ao doente, pedir um documento, fechar
// dados em falta, fazer follow-up. Nenhum é clínico — daí não haver 'dentist'
// em lado nenhum deste mapa. As tarefas internas de operações (escalamento de
// incidentes, checklist por iniciar) usam o mesmo tipo 'follow_up' mas passam
// ADMIN_TASK_ROLES explicitamente, porque quem tem de responder por elas é a
// direção da clínica, não a receção.
export const TASK_ROLE_ROUTING: Record<string, string[]> = {
  generic: ['receptionist'],
  call: ['receptionist'],
  document_request: ['receptionist'],
  data_missing: ['receptionist'],
  follow_up: ['receptionist'],
};

export const DEFAULT_TASK_ROLES = ['receptionist'];
export const ADMIN_TASK_ROLES = ['admin'];

export function preferredRolesForTaskType(type: string | null | undefined): string[] {
  return TASK_ROLE_ROUTING[String(type || '')] || DEFAULT_TASK_ROLES;
}

export interface AssigneeCandidate {
  userId: string;
  userName: string;
  role: string;
  // Dentro de um bloco de turno neste preciso momento (lib/staffAvailabilityCalc.ts).
  onShiftNow: boolean;
  // Tem pelo menos um bloco de turno hoje, mesmo que já tenha saído ou ainda não
  // tenha entrado — o segundo nível de preferência, ver pickAssignee.
  hasShiftToday: boolean;
  onLeaveToday: boolean;
  openTaskCount: number;
}

// Ordem determinística: menor carga primeiro, depois nome, depois id. O desempate
// por nome/id não é cosmético — é o que torna esta função testável e o que faz
// com que duas execuções do mesmo job com o mesmo estado deem o mesmo resultado.
function byLoadThenName(a: AssigneeCandidate, b: AssigneeCandidate) {
  if (a.openTaskCount !== b.openTaskCount) return a.openTaskCount - b.openTaskCount;
  if (a.userName !== b.userName) return a.userName < b.userName ? -1 : 1;
  return a.userId < b.userId ? -1 : 1;
}

export interface RankedAssignees {
  // Quem está mesmo a trabalhar agora — o grupo preferido.
  now: AssigneeCandidate[];
  // Quem tem turno hoje mas não está dentro dele neste momento (ex.: uma tarefa
  // criada pelo cron às 7h, antes de a receção abrir). Melhor do que ficar na
  // fila o dia inteiro.
  today: AssigneeCandidate[];
}

export function rankAssignees(candidates: AssigneeCandidate[], preferredRoles: string[]): RankedAssignees {
  const roles = new Set(preferredRoles);
  // Filtro por papel é estrito e sem fallback de propósito: se não há
  // rececionista disponível, a tarefa fica na fila partilhada em vez de cair em
  // cima de um clínico. O aviso de cobertura em falta
  // (detectCoverageGap) já existe precisamente para este caso.
  const eligible = candidates.filter((c) => roles.has(c.role) && !c.onLeaveToday);
  return {
    now: eligible.filter((c) => c.onShiftNow).sort(byLoadThenName),
    today: eligible.filter((c) => !c.onShiftNow && c.hasShiftToday).sort(byLoadThenName),
  };
}

// null = "deixa na fila da equipa". Nunca inventa um destinatário: uma tarefa
// atribuída a alguém que está de férias é pior do que uma tarefa sem dono, porque
// deixa de aparecer na fila partilhada que a equipa vai ver.
export function pickAssignee(candidates: AssigneeCandidate[], preferredRoles: string[]): string | null {
  const { now, today } = rankAssignees(candidates, preferredRoles);
  return now[0]?.userId ?? today[0]?.userId ?? null;
}
