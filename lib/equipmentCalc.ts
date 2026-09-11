// Helpers puros para manutenção de equipamento — sem imports de BD, testáveis como
// lib/inventoryCalc.ts. lib/equipment.ts liga isto às linhas reais.

export type EquipmentStatus = 'operational' | 'maintenance' | 'broken';
export type ServiceState = 'ok' | 'due_soon' | 'overdue' | 'never_serviced' | 'not_applicable';

export interface ServiceInput {
  /** NULL quando o equipamento não tem revisão periódica (um armário não tem). */
  serviceIntervalDays: number | null;
  /** 'YYYY-MM-DD', ou null se nunca foi assistido. */
  lastServicedAt: string | null;
}

// Quantos dias antes do vencimento é que vale a pena avisar. Curto de propósito: um
// aviso que aparece um mês antes deixa de ser lido muito antes de a revisão chegar.
export const SERVICE_WARN_DAYS = 14;

function daysBetween(from: string, to: Date): number {
  const start = new Date(`${from}T00:00:00`).getTime();
  if (Number.isNaN(start)) return Number.NaN;
  const end = new Date(`${to.toISOString().slice(0, 10)}T00:00:00`).getTime();
  return Math.round((end - start) / 86400000);
}

/**
 * Dias até à próxima revisão. Negativo = já passou. null quando não se aplica (sem
 * intervalo definido) ou quando nunca foi assistido — nesse caso não há "próxima", há
 * uma primeira, e é o `serviceState` que o diz.
 */
export function daysUntilService(input: ServiceInput, today: Date): number | null {
  if (!input.serviceIntervalDays || input.serviceIntervalDays <= 0) return null;
  if (!input.lastServicedAt) return null;
  const elapsed = daysBetween(input.lastServicedAt, today);
  if (Number.isNaN(elapsed)) return null;
  return input.serviceIntervalDays - elapsed;
}

export function serviceState(input: ServiceInput, today: Date, warnDays = SERVICE_WARN_DAYS): ServiceState {
  if (!input.serviceIntervalDays || input.serviceIntervalDays <= 0) return 'not_applicable';
  // Tem intervalo definido mas nunca foi assistido: é o caso mais fácil de esquecer,
  // porque não há data nenhuma a envelhecer no ecrã. Tem estado próprio por isso.
  if (!input.lastServicedAt) return 'never_serviced';
  const left = daysUntilService(input, today);
  if (left === null) return 'not_applicable';
  if (left < 0) return 'overdue';
  if (left <= warnDays) return 'due_soon';
  return 'ok';
}

/**
 * Um equipamento só conta como disponível se estiver no catálogo (active) E a
 * funcionar (status). Uma revisão vencida NÃO o torna indisponível — avisa, mas não
 * cancela a agenda de ninguém por si só; quem decide tirar de serviço é uma pessoa,
 * mudando o status.
 */
export function isEquipmentAvailable(equipment: { active: boolean; status: EquipmentStatus }): boolean {
  return equipment.active && equipment.status === 'operational';
}

/** Data da próxima revisão a partir da última, para mostrar no ecrã. */
export function nextServiceDate(input: ServiceInput): string | null {
  if (!input.serviceIntervalDays || input.serviceIntervalDays <= 0 || !input.lastServicedAt) return null;
  const base = new Date(`${input.lastServicedAt}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + input.serviceIntervalDays);
  return base.toLocaleDateString('en-CA');
}
