import { query, withTransaction } from './db';
import {
  daysUntilService,
  type EquipmentStatus,
  isEquipmentAvailable,
  nextServiceDate,
  type ServiceState,
  serviceState,
} from './equipmentCalc';

// Liga os helpers puros de lib/equipmentCalc.ts às linhas reais de clinic_equipment e
// equipment_maintenance (migração 043). É daqui que sai tanto o ecrã de equipamento
// como o job 'equipmentMaintenance' de lib/jobsRunner.ts.

export interface EquipmentOverviewRow {
  id: string;
  name: string;
  chair: number | null;
  tags: string[];
  active: boolean;
  status: EquipmentStatus;
  serialNumber: string | null;
  lastServicedAt: string | null;
  serviceIntervalDays: number | null;
  nextServiceAt: string | null;
  daysUntilService: number | null;
  serviceState: ServiceState;
  available: boolean;
  servicesLogged: number;
}

export async function computeEquipmentOverview(tenantId: string): Promise<EquipmentOverviewRow[]> {
  const rows = await query(
    `SELECT e.id, e.name, e.chair, e.tags, e.active, e.status, e.serial_number,
            e.last_serviced_at::text AS last_serviced_at, e.service_interval_days,
            (SELECT COUNT(*)::int FROM equipment_maintenance m WHERE m.equipment_id = e.id) AS services_logged
       FROM clinic_equipment e
      WHERE e.tenant_id = $1
      ORDER BY e.chair NULLS LAST, e.name`,
    [tenantId],
  );

  const today = new Date();
  return rows.map((r) => {
    const input = {
      serviceIntervalDays: r.service_interval_days === null ? null : Number(r.service_interval_days),
      lastServicedAt: r.last_serviced_at,
    };
    return {
      id: String(r.id),
      name: String(r.name),
      chair: r.chair === null ? null : Number(r.chair),
      tags: Array.isArray(r.tags) ? r.tags : [],
      active: !!r.active,
      status: String(r.status) as EquipmentStatus,
      serialNumber: r.serial_number || null,
      lastServicedAt: r.last_serviced_at,
      serviceIntervalDays: input.serviceIntervalDays,
      nextServiceAt: nextServiceDate(input),
      daysUntilService: daysUntilService(input, today),
      serviceState: serviceState(input, today),
      available: isEquipmentAvailable({ active: !!r.active, status: String(r.status) as EquipmentStatus }),
      servicesLogged: Number(r.services_logged || 0),
    };
  });
}

/**
 * Regista uma intervenção e adianta o relógio da próxima. As duas coisas na mesma
 * transação: um histórico que regista a assistência mas deixa `last_serviced_at` para
 * trás faz o equipamento continuar a aparecer como vencido — o pior dos dois mundos,
 * porque o alerta perde credibilidade e passa a ser ignorado.
 */
export async function logMaintenance(
  tenantId: string,
  equipmentId: string,
  userId: string | null,
  entry: {
    servicedAt: string;
    kind: 'preventive' | 'corrective' | 'inspection';
    technician?: string;
    cost?: number | null;
    notes?: string;
    /** Voltar a pôr operacional é o normal depois de uma reparação, mas não é automático. */
    setStatus?: EquipmentStatus;
  },
) {
  return withTransaction(async (client) => {
    const { rows: eqRows } = await client.query(
      `SELECT * FROM clinic_equipment WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,
      [equipmentId, tenantId],
    );
    if (!eqRows[0]) return { error: 'not_found' as const };

    const { rows: logRows } = await client.query(
      `INSERT INTO equipment_maintenance (tenant_id, equipment_id, serviced_at, kind, technician, cost, notes, created_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8) RETURNING *`,
      [
        tenantId,
        equipmentId,
        entry.servicedAt,
        entry.kind,
        (entry.technician || '').slice(0, 200),
        entry.cost ?? null,
        (entry.notes || '').slice(0, 2000),
        userId,
      ],
    );

    // GREATEST: registar uma intervenção antiga (alguém a lançar histórico atrasado)
    // não pode recuar a data da última assistência conhecida.
    const { rows: updRows } = await client.query(
      `UPDATE clinic_equipment
          SET last_serviced_at = GREATEST(COALESCE(last_serviced_at, $3::date), $3::date),
              status = COALESCE($4, status),
              updated_at = NOW()
        WHERE id=$1 AND tenant_id=$2
      RETURNING *`,
      [equipmentId, tenantId, entry.servicedAt, entry.setStatus ?? null],
    );

    return { maintenance: logRows[0], equipment: updRows[0] };
  });
}

export async function listMaintenance(tenantId: string, equipmentId: string) {
  return query(
    `SELECT m.*, u.name AS created_by_name
       FROM equipment_maintenance m
       LEFT JOIN users u ON u.id = m.created_by
      WHERE m.tenant_id=$1 AND m.equipment_id=$2
      ORDER BY m.serviced_at DESC, m.created_at DESC
      LIMIT 100`,
    [tenantId, equipmentId],
  );
}

/**
 * Chamado pelo job 'equipmentMaintenance' (ver lib/jobsRunner.ts, agente Operações).
 * Devolve o que precisa de atenção — não escreve nada nem contacta ninguém; quem
 * transforma isto em tarefa é o job, que também é quem sabe deduplicar.
 */
export async function findEquipmentNeedingAttention(tenantId: string) {
  const overview = await computeEquipmentOverview(tenantId);
  return {
    overdue: overview.filter((e) => e.serviceState === 'overdue'),
    dueSoon: overview.filter((e) => e.serviceState === 'due_soon'),
    neverServiced: overview.filter((e) => e.serviceState === 'never_serviced'),
    outOfService: overview.filter((e) => e.active && !e.available),
  };
}
