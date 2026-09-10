import {
  type AllocationBasis,
  type AllocationMethod,
  allocatedFixedCost,
  computeMargin,
  costCoverage,
  DEFAULT_ALLOCATION_METHOD,
  isAllocationMethod,
  labourCost,
  type Margin,
  materialCostForProcedure,
  sumMargins,
  unitCostFor,
  weightedAverageCost,
} from './costingCalc';
import { query, queryOne, queryRead } from './db';

// Liga lib/costingCalc.ts a linhas reais. A aritmética não sabe SQL; isto não decide
// nada — nem sequer o método de imputação, que é um campo por clínica
// (tenant_cost_settings, migração 047).
//
// ─── Como se chega ao custo de uma consulta ─────────────────────────────────
//   material   procedure_item_usage (o QUE consome, migração 029)
//              × custo unitário (o QUANTO custa, migração 047)
//   mão de obra  duração × custo/hora do dentista, ou o da clínica
//   fixo       o método escolhido, aplicado à duração ou à contagem
//
// Nenhuma destas três partes é nova. As duas primeiras existiam a meio — a ligação
// tipo-de-consulta→material estava construída para prever compras, e faltava-lhe o
// preço; a duração está em appointments desde sempre. É por isso que isto é a lacuna
// mais barata de fechar do produto inteiro: a cadeia estava toda montada.

export interface CostSettings {
  allocationMethod: AllocationMethod;
  fixedCostMonthly: number;
  labourCostPerHour: number;
}

export async function getCostSettings(tenantId: string): Promise<CostSettings> {
  const row = await queryOne(
    `SELECT allocation_method, fixed_cost_monthly, labour_cost_per_hour
     FROM tenant_cost_settings WHERE tenant_id=$1`,
    [tenantId],
  );
  return {
    // Uma clínica que nunca abriu o ecrã de definições fica com o método por omissão e
    // custo fixo zero — o que produz margem de contribuição, correta e incompleta, em
    // vez de um erro ou de um número inventado.
    allocationMethod: isAllocationMethod(row?.allocation_method) ? row.allocation_method : DEFAULT_ALLOCATION_METHOD,
    fixedCostMonthly: Number(row?.fixed_cost_monthly || 0),
    labourCostPerHour: Number(row?.labour_cost_per_hour || 0),
  };
}

export async function saveCostSettings(
  tenantId: string,
  userId: string | null,
  input: Partial<CostSettings> & { notes?: string },
) {
  const method = isAllocationMethod(input.allocationMethod) ? input.allocationMethod : DEFAULT_ALLOCATION_METHOD;
  const [row] = await query(
    `INSERT INTO tenant_cost_settings (tenant_id, allocation_method, fixed_cost_monthly, labour_cost_per_hour, notes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tenant_id) DO UPDATE SET
       allocation_method = EXCLUDED.allocation_method,
       fixed_cost_monthly = EXCLUDED.fixed_cost_monthly,
       labour_cost_per_hour = EXCLUDED.labour_cost_per_hour,
       notes = EXCLUDED.notes,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()
     RETURNING *`,
    [tenantId, method, input.fixedCostMonthly ?? null, input.labourCostPerHour ?? null, input.notes ?? '', userId],
  );
  return row;
}

// Custo unitário efetivo por item: média ponderada dos lotes com custo registado, e o
// preço de catálogo/clínica como referência quando não há lotes custeados (stock
// anterior à migração 047, ou lançado à mão).
export async function unitCostsByItem(tenantId: string): Promise<Map<number, number | null>> {
  const rows = await queryRead(
    `SELECT i.id,
            COALESCE(s.unit_cost, i.unit_cost) AS reference_cost,
            COALESCE(
              json_agg(json_build_object('quantity', b.quantity, 'unitCost', b.unit_cost))
                FILTER (WHERE b.id IS NOT NULL AND b.quantity > 0),
              '[]'
            ) AS batches
     FROM inventory_items i
     LEFT JOIN inventory_item_settings s ON s.item_id = i.id AND s.tenant_id = $1
     LEFT JOIN inventory_batches b ON b.item_id = i.id AND b.tenant_id = $1
     GROUP BY i.id, s.unit_cost, i.unit_cost`,
    [tenantId],
  );

  const out = new Map<number, number | null>();
  for (const r of rows) {
    const reference = unitCostFor(r.reference_cost, null);
    const hasReference = r.reference_cost != null;
    const batches = Array.isArray(r.batches) ? r.batches : [];
    const hasCostedBatch = batches.some((b: { unitCost: unknown }) => b.unitCost != null);
    if (!hasReference && !hasCostedBatch) {
      // Sem preço em lado nenhum. null, e não 0 — a diferença entre «não sabemos» e
      // «é grátis» é a diferença entre uma margem com aviso e uma margem falsa.
      out.set(Number(r.id), null);
      continue;
    }
    out.set(Number(r.id), weightedAverageCost(batches, reference));
  }
  return out;
}

// Custo de material por tipo de consulta, a partir de procedure_item_usage.
export async function materialCostByAppointmentType(tenantId: string) {
  const [usage, costs] = await Promise.all([
    queryRead(`SELECT appointment_type, item_id, qty_per_procedure FROM procedure_item_usage WHERE tenant_id=$1`, [
      tenantId,
    ]),
    unitCostsByItem(tenantId),
  ]);

  const byType = new Map<string, { cost: number; itemsWithCost: number; itemsTotal: number }>();
  for (const u of usage) {
    const type = String(u.appointment_type);
    const entry = byType.get(type) || { cost: 0, itemsWithCost: 0, itemsTotal: 0 };
    const unitCost = costs.get(Number(u.item_id));
    entry.itemsTotal += 1;
    if (unitCost != null) {
      entry.itemsWithCost += 1;
      entry.cost += materialCostForProcedure([
        { itemId: Number(u.item_id), qtyPerProcedure: Number(u.qty_per_procedure) || 0, unitCost },
      ]);
    }
    byType.set(type, entry);
  }
  return byType;
}

// A base de imputação do período: horas de cadeira OCUPADAS e número de consultas.
// Ocupadas e não disponíveis — ver o comentário de AllocationBasis em
// lib/costingCalc.ts: com base nas disponíveis, uma clínica a metade da ocupação veria
// a margem de cada tratamento intacta e a perda escondida numa linha que ninguém lê.
async function allocationBasisFor(tenantId: string, from: string, to: string, settings: CostSettings) {
  const row = await queryOne(
    `SELECT COALESCE(SUM(duration), 0)::numeric AS minutes, COUNT(*)::int AS appointments
     FROM appointments
     WHERE tenant_id=$1 AND appt_date BETWEEN $2::date AND $3::date AND status='departed'`,
    [tenantId, from, to],
  );
  const months = Math.max(
    1 / 30,
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (30.44 * 86_400_000) || 1,
  );
  const basis: AllocationBasis = {
    method: settings.allocationMethod,
    // O custo fixo é mensal; o período pode ser qualquer um. Escalar em vez de assumir
    // o mês evita que um relatório trimestral impute um único mês de estrutura a três
    // meses de trabalho.
    fixedCostForPeriod: settings.fixedCostMonthly * months,
    occupiedChairHours: (Number(row?.minutes) || 0) / 60,
    appointmentsInPeriod: Number(row?.appointments) || 0,
  };
  return basis;
}

export interface MarginBreakdown {
  key: string;
  label: string;
  appointments: number;
  margin: Margin;
}

export interface MarginReport {
  from: string;
  to: string;
  method: AllocationMethod;
  total: Margin;
  byDentist: MarginBreakdown[];
  byChair: MarginBreakdown[];
  byTreatmentType: MarginBreakdown[];
  coverage: ReturnType<typeof costCoverage>;
  // Aviso legível quando a clínica ainda não declarou custo fixo: sem ele a margem
  // líquida iguala a de contribuição, e alguém que leia "margem de 62%" sem saber isto
  // tira a conclusão errada.
  warnings: string[];
}

// A receita de uma consulta vem das faturas ligadas a ela (migração 042). Consultas sem
// fatura contam para o custo e não para a receita — o que está correto e é visível: uma
// consulta realizada e nunca faturada é receita perdida, e escondê-la do denominador
// tornaria a margem melhor do que a clínica teve.
export async function computeMarginReport(tenantId: string, from: string, to: string): Promise<MarginReport> {
  const settings = await getCostSettings(tenantId);
  const [basis, materialByType, rows] = await Promise.all([
    allocationBasisFor(tenantId, from, to, settings),
    materialCostByAppointmentType(tenantId),
    queryRead(
      `SELECT a.id, a.type, a.chair, a.duration, a.dentist_id,
              COALESCE(u.name, 'Sem dentista atribuído') AS dentist_name,
              u.labour_cost_per_hour AS dentist_hourly,
              COALESCE((SELECT SUM(i.amount) FROM invoices i WHERE i.appointment_id = a.id AND i.status <> 'cancelled'), 0)::numeric AS revenue
       FROM appointments a
       LEFT JOIN users u ON u.id = a.dentist_id
       WHERE a.tenant_id=$1 AND a.appt_date BETWEEN $2::date AND $3::date AND a.status='departed'`,
      [tenantId, from, to],
    ),
  ]);

  const groups = {
    dentist: new Map<string, { label: string; margins: Margin[] }>(),
    chair: new Map<string, { label: string; margins: Margin[] }>(),
    type: new Map<string, { label: string; margins: Margin[] }>(),
  };
  const all: Margin[] = [];
  let itemsWithCost = 0;
  let itemsTotal = 0;

  for (const r of rows) {
    const type = String(r.type);
    const material = materialByType.get(type);
    if (material) {
      itemsWithCost += material.itemsWithCost;
      itemsTotal += material.itemsTotal;
    }
    const duration = Number(r.duration) || 0;
    // O custo/hora do dentista sobrepõe-se ao da clínica quando existe — mesmo padrão
    // de catálogo/override de todo o projeto.
    const hourly = r.dentist_hourly == null ? settings.labourCostPerHour : Number(r.dentist_hourly);

    const margin = computeMargin({
      revenue: Number(r.revenue) || 0,
      materialCost: material?.cost || 0,
      labourCost: labourCost(duration, hourly),
      allocatedFixedCost: allocatedFixedCost(basis, duration),
    });
    all.push(margin);

    const push = (map: Map<string, { label: string; margins: Margin[] }>, key: string, label: string) => {
      const entry = map.get(key) || { label, margins: [] };
      entry.margins.push(margin);
      map.set(key, entry);
    };
    push(groups.dentist, String(r.dentist_id || 'unassigned'), String(r.dentist_name));
    push(groups.chair, String(r.chair), `Cadeira ${r.chair}`);
    push(groups.type, type, type);
  }

  const toBreakdown = (map: Map<string, { label: string; margins: Margin[] }>): MarginBreakdown[] =>
    Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, appointments: v.margins.length, margin: sumMargins(v.margins) }))
      // Pior margem líquida primeiro. Ordenar por receita poria no topo o que já se
      // sabe; o que interessa descobrir é onde é que se trabalha para trás.
      .sort((a, b) => a.margin.netMargin - b.margin.netMargin);

  const warnings: string[] = [];
  if (settings.allocationMethod === 'direct_only') {
    warnings.push(
      'Método "só custo direto": a margem apresentada é de contribuição — o que cada tratamento deixa para pagar a estrutura. Não é lucro.',
    );
  } else if (settings.fixedCostMonthly <= 0) {
    warnings.push(
      'Custo fixo mensal não declarado: a margem líquida está a coincidir com a de contribuição. Preencher em Definições → Custos.',
    );
  }
  if (settings.labourCostPerHour <= 0) {
    warnings.push('Custo/hora de clínico não declarado: a mão de obra está a contar zero.');
  }
  const coverage = costCoverage(itemsWithCost, itemsTotal);
  if (!coverage.reliable) {
    warnings.push(
      `Só ${coverage.coveragePct}% dos consumos mapeados têm custo registado — a margem de material está subavaliada.`,
    );
  }

  return {
    from,
    to,
    method: settings.allocationMethod,
    total: sumMargins(all),
    byDentist: toBreakdown(groups.dentist),
    byChair: toBreakdown(groups.chair),
    byTreatmentType: toBreakdown(groups.type),
    coverage,
    warnings,
  };
}
