import { query } from './db';

// O valor económico de encher uma cadeira — o fator que faltava para o agente de
// agenda poder comparar duas propostas que ocupam os mesmos 45 minutos.
//
// Não há tabela de preços por tipo de consulta neste produto, e inventar uma
// seria pedir à clínica que mantivesse a mesma informação em dois sítios. Há
// coisa melhor: desde a migração 042 cada consulta pode ter o seu valor
// lançado (invoices.appointment_id), por isso o que uma "Endodontia" vale NESTA
// clínica é uma pergunta que os dados já respondem.
//
// Usa-se a MEDIANA e não a média: uma reabilitação faturada num único registo,
// ou uma cortesia a 0 €, puxam uma média de meia dúzia de consultas para um
// valor que não representa nenhuma delas.

const HISTORY_MONTHS = 12;
// Abaixo disto a mediana é uma anedota, não uma estatística — cai-se para a
// mediana global da clínica.
const MIN_SAMPLE = 3;

export interface TypeValues {
  /** Mediana por tipo de consulta, em euros. */
  byType: Map<string, number>;
  /** Mediana de todas as consultas faturadas — o valor de recurso. */
  overall: number;
  sampleSize: number;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function loadTypeValues(tenantId: string): Promise<TypeValues> {
  const rows = await query(
    `SELECT a.type, i.amount::numeric AS amount
       FROM invoices i
       JOIN appointments a ON a.id = i.appointment_id
      WHERE i.tenant_id=$1
        AND i.invoice_date >= (CURRENT_DATE - ($2::int * INTERVAL '1 month'))
        AND i.amount > 0`,
    [tenantId, HISTORY_MONTHS],
  );

  const byTypeRaw = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of rows) {
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const type = String(r.type || '').trim();
    all.push(amount);
    if (!type) continue;
    byTypeRaw.set(type, [...(byTypeRaw.get(type) || []), amount]);
  }

  const overall = median(all);
  const byType = new Map<string, number>();
  for (const [type, values] of byTypeRaw) {
    if (values.length >= MIN_SAMPLE) byType.set(type, median(values));
  }

  return { byType, overall, sampleSize: all.length };
}

/**
 * O valor a atribuir a uma consulta deste tipo. Zero quando a clínica ainda não
 * lançou valores nenhuns — e zero é o comportamento certo: o fator do valor
 * simplesmente não contribui para a pontuação, em vez de a envenenar com um
 * número inventado. Ver DEMAND_WEIGHTS em lib/demandPoolCalc.ts.
 */
export function valueOfType(values: TypeValues, type: string): number {
  return values.byType.get(String(type || '').trim()) ?? values.overall;
}
