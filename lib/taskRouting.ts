import { query } from './db';
import { isOnApprovedLeave, isOnShift, type ScheduleBlock, type TimeOffRange } from './staffAvailabilityCalc';
import { type AssigneeCandidate, pickAssignee, preferredRolesForTaskType } from './taskRoutingCalc';

// Item 11 — "distribuição de tarefas": a metade que toca na base de dados.
// Junta staff_schedules + staff_time_off + a carga aberta de cada pessoa e passa
// isso ao decisor puro em lib/taskRoutingCalc.ts. Mesma divisão de
// lib/staffSchedule.ts vs lib/staffAvailabilityCalc.ts.

export interface ResolveAssigneeOptions {
  type?: string | null;
  // Sobrepõe o mapa por tipo — usado pelas tarefas internas de operações, que são
  // do tipo 'follow_up' mas têm de ir para a direção (ver ADMIN_TASK_ROLES).
  preferredRoles?: string[];
  at?: Date;
}

// Carrega os candidatos de um tenant no momento `at`. Exportado à parte de
// resolveAssignee porque a varredura periódica (job assignOrphanTasks) atribui
// muitas tarefas de uma vez e não faz sentido repetir estas três queries por
// tarefa — carrega uma vez, decide N vezes.
export async function loadAssigneeCandidates(tenantId: string, at: Date = new Date()): Promise<AssigneeCandidate[]> {
  const weekday = at.getDay();
  const dateStr = at.toLocaleDateString('en-CA'); // local YYYY-MM-DD, mesma razão de lib/staffSchedule.ts

  const [users, shifts, timeOff, loads] = await Promise.all([
    query(`SELECT id, name, role FROM users WHERE tenant_id=$1 AND active=TRUE`, [tenantId]),
    query(`SELECT user_id, start_time, end_time FROM staff_schedules WHERE tenant_id=$1 AND weekday=$2`, [
      tenantId,
      weekday,
    ]),
    query(
      `SELECT user_id, start_date::text, end_date::text, status FROM staff_time_off
       WHERE tenant_id=$1 AND status='approved' AND start_date <= $2::date AND end_date >= $2::date`,
      [tenantId, dateStr],
    ),
    query(
      `SELECT assigned_to AS user_id, COUNT(*)::int AS open_count
       FROM patient_tasks
       WHERE tenant_id=$1 AND status='pending' AND assigned_to IS NOT NULL
       GROUP BY assigned_to`,
      [tenantId],
    ),
  ]);

  const shiftsByUser = new Map<string, ScheduleBlock[]>();
  for (const s of shifts) {
    const list = shiftsByUser.get(s.user_id) || [];
    list.push({ weekday, startTime: String(s.start_time).slice(0, 5), endTime: String(s.end_time).slice(0, 5) });
    shiftsByUser.set(s.user_id, list);
  }
  const leaveByUser = new Map<string, TimeOffRange[]>();
  for (const t of timeOff) {
    const list = leaveByUser.get(t.user_id) || [];
    list.push({ startDate: t.start_date, endDate: t.end_date, status: t.status });
    leaveByUser.set(t.user_id, list);
  }
  const loadByUser = new Map<string, number>(loads.map((r) => [String(r.user_id), Number(r.open_count || 0)]));

  return users.map((u) => {
    const blocks = shiftsByUser.get(u.id) || [];
    const ranges = leaveByUser.get(u.id) || [];
    return {
      userId: String(u.id),
      userName: String(u.name),
      role: String(u.role),
      onShiftNow: isOnShift(blocks, at),
      hasShiftToday: blocks.length > 0,
      onLeaveToday: isOnApprovedLeave(ranges, dateStr),
      openTaskCount: loadByUser.get(String(u.id)) || 0,
    };
  });
}

// Devolve null quando não há ninguém elegível — o chamador deixa a tarefa na fila
// partilhada (assigned_to NULL), que é o comportamento que já existia.
export async function resolveAssignee(tenantId: string, opts: ResolveAssigneeOptions = {}): Promise<string | null> {
  const candidates = await loadAssigneeCandidates(tenantId, opts.at);
  const roles = opts.preferredRoles?.length ? opts.preferredRoles : preferredRolesForTaskType(opts.type);
  return pickAssignee(candidates, roles);
}

// A varredura do job: apanha tarefas que ficaram sem dono — as criadas antes desta
// funcionalidade existir, as criadas quando não havia ninguém de turno, e as que
// um humano criou sem escolher destinatário. Só toca em assigned_to IS NULL, por
// isso nunca reescreve uma escolha humana.
//
// A carga (openTaskCount) é recalculada em memória à medida que se atribui, senão
// uma varredura de 20 tarefas despejava-as todas na mesma pessoa — o snapshot de
// carga foi tirado uma única vez antes do ciclo.
export async function assignOrphanTasks(tenantId: string, limit = 100) {
  const orphans = await query(
    `SELECT id, type FROM patient_tasks
     WHERE tenant_id=$1 AND status='pending' AND assigned_to IS NULL
     ORDER BY (due_at IS NULL), due_at, created_at
     LIMIT $2`,
    [tenantId, limit],
  );
  if (!orphans.length) return { scanned: 0, assigned: 0 };

  const candidates = await loadAssigneeCandidates(tenantId);
  let assigned = 0;
  for (const t of orphans) {
    const userId = pickAssignee(candidates, preferredRolesForTaskType(t.type));
    if (!userId) continue;
    await query(`UPDATE patient_tasks SET assigned_to=$1, auto_assigned=TRUE WHERE id=$2 AND assigned_to IS NULL`, [
      userId,
      t.id,
    ]);
    const c = candidates.find((x) => x.userId === userId);
    if (c) c.openTaskCount += 1;
    assigned += 1;
  }
  return { scanned: orphans.length, assigned };
}
