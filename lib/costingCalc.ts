// Puro — sem imports de DB, testável como lib/inventoryCalc.ts e lib/reportsCalc.ts.
//
// ─── A lacuna que isto fecha ────────────────────────────────────────────────
// Até aqui o modelo de dados tinha UMA coluna de custo em toda a base:
// equipment_maintenance.cost. `inventory_items` não tinha preço,
// `purchase_order_items` não tinha custo unitário, e não havia nenhuma noção de custo
// fixo. Sem isso não existe margem — e "receita por dentista", "receita por cadeira" e
// "receita por tratamento" ficam a meio caminho: dizem quanto entrou, nunca quanto
// sobrou. Uma cadeira pode ser a que mais fatura e a que menos dá.
//
// ─── A decisão que não é de engenharia ──────────────────────────────────────
// Somar o custo direto (material consumido) é aritmética. Imputar o custo FIXO —
// renda, salários da receção, software, seguros — é contabilidade: a mesma clínica com
// os mesmos números dá margens diferentes conforme a base de imputação, e nenhuma das
// bases está "certa". Por isso o método não está escrito no código: é uma definição
// por clínica (tenant_cost_settings.allocation_method, migração 047) e este módulo
// implementa os três que fazem sentido para uma clínica dentária.
//
// O default é 'per_chair_hour' — hora de cadeira ocupada — porque é a base que torna
// comparáveis as duas coisas que este produto já mede por cadeira e por hora, e porque
// a capacidade de uma clínica dentária é, literalmente, cadeiras × horas. Quem
// discordar muda o campo; quem não quiser imputar nada escolhe 'direct_only' e fica
// com margem de contribuição, que é uma resposta honesta e não uma resposta em falta.

export const ALLOCATION_METHODS = ['direct_only', 'per_chair_hour', 'per_appointment'] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

export const ALLOCATION_METHOD_LABELS: Record<AllocationMethod, string> = {
  direct_only: 'Só custo direto (margem de contribuição)',
  per_chair_hour: 'Custo fixo por hora de cadeira ocupada',
  per_appointment: 'Custo fixo por consulta',
};

export const ALLOCATION_METHOD_NOTES: Record<AllocationMethod, string> = {
  direct_only:
    'Não imputa custo fixo. A margem que sai é de contribuição: o que cada tratamento deixa para pagar a estrutura. Não confundir com lucro.',
  per_chair_hour:
    'Reparte o custo fixo do mês pelas horas de cadeira efetivamente ocupadas. Uma consulta de 90 minutos carrega o triplo de uma de 30. É a base que penaliza os espaços vazios, porque quanto menos se ocupa mais caro fica cada hora ocupada.',
  per_appointment:
    'Reparte o custo fixo do mês pelo número de consultas, independentemente da duração. Mais simples de explicar; trata uma consulta de controlo como uma reabilitação.',
};

export const DEFAULT_ALLOCATION_METHOD: AllocationMethod = 'per_chair_hour';

export function isAllocationMethod(v: unknown): v is AllocationMethod {
  return typeof v === 'string' && (ALLOCATION_METHODS as readonly string[]).includes(v);
}

// Arredondamento a cêntimos numa função só, porque dinheiro comparado com dinheiro
// arredondado de maneiras diferentes produz discrepâncias de um cêntimo que ninguém
// consegue explicar num mapa financeiro.
export function roundEUR(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// ─── Custo unitário: catálogo global, override por clínica ──────────────────
// Exatamente o padrão que a migração 044 já estabeleceu para o ponto de reposição:
// o catálogo de itens é partilhado por todas as clínicas do grupo (ninguém quer manter
// a mesma lista de luvas vinte vezes) mas o PREÇO não é partilhável — cada clínica
// compra a quem quer, ao preço que negociou. O global é o valor de referência; a linha
// da clínica manda quando existe.
export function unitCostFor(catalogCost: unknown, tenantOverride: unknown): number {
  const override = Number(tenantOverride);
  if (Number.isFinite(override) && override >= 0 && tenantOverride !== null && tenantOverride !== '') {
    return roundEUR(override);
  }
  const catalog = Number(catalogCost);
  return Number.isFinite(catalog) && catalog >= 0 ? roundEUR(catalog) : 0;
}

// ─── Custo médio ponderado do stock ─────────────────────────────────────────
// O custo a que se valoriza o que está em armazém e a que se debita o que sai. Média
// ponderada e não FEFO-por-lote de propósito, apesar de lib/inventoryCalc.ts consumir
// por FEFO: o consumo físico segue a validade (tira-se primeiro o que estraga
// primeiro), mas debitar o custo do lote concreto que saiu faria o custo do mesmo
// tratamento variar de semana para semana ao sabor de quando calhou a última
// encomenda — ruído que não diz nada sobre o tratamento.
//
// Lotes sem custo registado (recebidos antes da migração 047, ou lançados à mão) são
// ignorados no numerador E no denominador, para não puxarem a média para baixo como se
// tivessem sido oferecidos.
export interface CostedBatch {
  quantity: number;
  unitCost: number | null;
}

export function weightedAverageCost(batches: CostedBatch[], fallbackUnitCost = 0): number {
  let value = 0;
  let units = 0;
  for (const b of batches) {
    const qty = Number(b.quantity) || 0;
    const cost = b.unitCost == null ? null : Number(b.unitCost);
    if (qty <= 0 || cost == null || !Number.isFinite(cost)) continue;
    value += qty * cost;
    units += qty;
  }
  if (units <= 0) return roundEUR(fallbackUnitCost);
  return roundEUR(value / units);
}

// Valor imobilizado em stock. Usa o custo por unidade que o chamador já resolveu (média
// ponderada, ou o de catálogo quando não há lotes custeados).
export function stockValue(quantity: unknown, unitCost: unknown): number {
  const q = Math.max(0, Number(quantity) || 0);
  return roundEUR(q * (Number(unitCost) || 0));
}

// ─── Custo direto de um procedimento ────────────────────────────────────────
// procedure_item_usage (migração 029) já diz que material é que um tipo de consulta
// consome e em que quantidade — é a tabela que alimenta a previsão de compras. A mesma
// ligação, multiplicada por um preço, dá o custo de material de cada consulta. Não foi
// preciso inventar modelo nenhum: faltava só a coluna do preço.
export interface ProcedureUsageCost {
  itemId: number;
  qtyPerProcedure: number;
  unitCost: number;
}

export function materialCostForProcedure(usage: ProcedureUsageCost[]): number {
  return roundEUR(
    usage.reduce((sum, u) => sum + Math.max(0, Number(u.qtyPerProcedure) || 0) * (Number(u.unitCost) || 0), 0),
  );
}

// ─── Custo de mão de obra ───────────────────────────────────────────────────
// Por hora de clínico, aplicado à duração da consulta. É o único custo variável além
// do material que uma clínica dentária consegue imputar sem se enganar: o tempo do
// dentista é consumido pela consulta e por mais nada.
//
// Zero quando a clínica não declarou custo/hora — e zero é a resposta certa, porque
// inventar um valor médio de mercado produziria uma margem com aparência de rigor e
// nenhum.
export function labourCost(durationMinutes: unknown, hourlyCost: unknown): number {
  const minutes = Math.max(0, Number(durationMinutes) || 0);
  const hourly = Math.max(0, Number(hourlyCost) || 0);
  return roundEUR((minutes / 60) * hourly);
}

// ─── Imputação do custo fixo ────────────────────────────────────────────────

export interface AllocationBasis {
  method: AllocationMethod;
  // Custo fixo do período (tipicamente o mês): renda, salários não clínicos, software,
  // seguros, amortizações.
  fixedCostForPeriod: number;
  // Horas de cadeira efetivamente OCUPADAS no período. Deliberadamente ocupadas e não
  // disponíveis: com base nas disponíveis, uma clínica a metade da ocupação veria a
  // margem de cada tratamento intacta e a perda escondida numa linha de "capacidade
  // não utilizada" que ninguém lê. Com base nas ocupadas, a hora ocupada fica mais
  // cara quando se ocupa menos, e a margem de cada tratamento diz a verdade sobre o
  // mês que a clínica teve.
  occupiedChairHours: number;
  appointmentsInPeriod: number;
}

// Custo fixo por unidade de imputação: por hora de cadeira, por consulta, ou nada.
export function fixedCostRate(basis: AllocationBasis): number {
  const fixed = Math.max(0, Number(basis.fixedCostForPeriod) || 0);
  if (basis.method === 'direct_only' || fixed === 0) return 0;
  if (basis.method === 'per_chair_hour') {
    const hours = Number(basis.occupiedChairHours) || 0;
    return hours > 0 ? roundEUR(fixed / hours) : 0;
  }
  const appts = Number(basis.appointmentsInPeriod) || 0;
  return appts > 0 ? roundEUR(fixed / appts) : 0;
}

// O custo fixo que cabe a UMA consulta, dado o método e a sua duração.
export function allocatedFixedCost(basis: AllocationBasis, durationMinutes: unknown): number {
  const rate = fixedCostRate(basis);
  if (rate === 0) return 0;
  if (basis.method === 'per_appointment') return rate;
  const minutes = Math.max(0, Number(durationMinutes) || 0);
  return roundEUR((minutes / 60) * rate);
}

// ─── Margem ─────────────────────────────────────────────────────────────────
// Duas margens, e a distinção entre elas não é cosmética:
//
//   CONTRIBUIÇÃO  receita − material − mão de obra.  O que este tratamento deixa
//                 para pagar a estrutura. Nunca é negativa numa clínica saudável.
//   LÍQUIDA       contribuição − custo fixo imputado.  O que sobra de facto. Pode
//                 ser negativa, e um tratamento com contribuição positiva e margem
//                 líquida negativa é exatamente a informação que faltava.
//
// Com 'direct_only' as duas coincidem, e é por isso que o método vem sempre ao lado do
// número em ALLOCATION_METHOD_NOTES: uma margem sem a base de imputação declarada é um
// número que se pode ler ao contrário.
export interface MarginInputs {
  revenue: number;
  materialCost?: number;
  labourCost?: number;
  allocatedFixedCost?: number;
}

export interface Margin {
  revenue: number;
  materialCost: number;
  labourCost: number;
  allocatedFixedCost: number;
  contributionMargin: number;
  contributionMarginPct: number | null;
  netMargin: number;
  netMarginPct: number | null;
}

// Percentagem null e não 0 quando não há receita: 0% sugere "não deu margem", quando o
// que se passa é que não houve nada de que a tirar. Mesma regra que pctChange em
// lib/reportsCalc.ts.
function pctOf(value: number, base: number): number | null {
  if (!base) return null;
  return Math.round((value / base) * 1000) / 10;
}

export function computeMargin(inputs: MarginInputs): Margin {
  const revenue = roundEUR(inputs.revenue);
  const material = roundEUR(inputs.materialCost);
  const labour = roundEUR(inputs.labourCost);
  const fixed = roundEUR(inputs.allocatedFixedCost);
  const contribution = roundEUR(revenue - material - labour);
  const net = roundEUR(contribution - fixed);
  return {
    revenue,
    materialCost: material,
    labourCost: labour,
    allocatedFixedCost: fixed,
    contributionMargin: contribution,
    contributionMarginPct: pctOf(contribution, revenue),
    netMargin: net,
    netMarginPct: pctOf(net, revenue),
  };
}

// Soma margens já calculadas — por dentista, por cadeira, por tratamento. Recalcula as
// percentagens sobre os totais em vez de as somar, que é o erro clássico: a média das
// percentagens não é a percentagem do total.
export function sumMargins(margins: Margin[]): Margin {
  const total = margins.reduce(
    (acc, m) => ({
      revenue: acc.revenue + m.revenue,
      materialCost: acc.materialCost + m.materialCost,
      labourCost: acc.labourCost + m.labourCost,
      allocatedFixedCost: acc.allocatedFixedCost + m.allocatedFixedCost,
    }),
    { revenue: 0, materialCost: 0, labourCost: 0, allocatedFixedCost: 0 },
  );
  return computeMargin(total);
}

// ─── Qualidade do resultado ─────────────────────────────────────────────────
// Uma margem calculada sobre metade dos itens sem preço é pior do que inútil: parece
// boa. Isto acompanha sempre o número e diz de que é que ele é feito, para a UI poder
// mostrar "78% dos consumos têm custo registado" em vez de deixar alguém tomar uma
// decisão sobre uma margem oca.
export interface CostCoverage {
  itemsWithCost: number;
  itemsTotal: number;
  coveragePct: number;
  reliable: boolean;
}

// Mesmo limiar de fiabilidade usado por lib/forecast.ts para as previsões: abaixo
// disto o número mostra-se com aviso, não se esconde — esconder impediria a clínica de
// perceber que lhe falta preencher os preços.
export const COST_COVERAGE_RELIABLE_PCT = 70;

export function costCoverage(itemsWithCost: unknown, itemsTotal: unknown): CostCoverage {
  const withCost = Math.max(0, Number(itemsWithCost) || 0);
  const total = Math.max(0, Number(itemsTotal) || 0);
  const pct = total > 0 ? Math.round((withCost / total) * 100) : 0;
  return {
    itemsWithCost: withCost,
    itemsTotal: total,
    coveragePct: pct,
    reliable: total > 0 && pct >= COST_COVERAGE_RELIABLE_PCT,
  };
}
