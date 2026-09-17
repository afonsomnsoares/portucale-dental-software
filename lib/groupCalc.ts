// Puro — sem DB, sem IA, testável como lib/agents/coordinationCalc.ts.
//
// lib/reports.ts:computeClinicComparison já compara as clínicas: receita, conversão,
// faltas, ocupação, e o «gap» em euros entre a melhor e a pior. Isso é um diagnóstico —
// diz onde está a diferença e não diz o que fazer com ela.
//
// Este ficheiro é o passo seguinte: com procura a mais numa unidade e capacidade a mais
// noutra, qual é a redistribuição concreta, e quanto é que ela vale. É a versão de grupo
// do que lib/scheduleOptimizerCalc.ts faz dentro de uma clínica.

// ─── 1. Onde há procura a mais e capacidade a mais ──────────────────────────
// A unidade de medida é o MINUTO de cadeira, e não «doentes» nem «vagas»: é a única que
// se pode somar entre clínicas com tamanhos diferentes e a única que a procura e a
// capacidade partilham. Uma lista de espera de 12 pessoas não diz nada sobre 9 horas
// livres até as duas estarem em minutos.

export interface ClinicCapacity {
  tenantId: string;
  name: string;
  /** Minutos de cadeira já marcados no horizonte. */
  bookedMinutes: number;
  /** Minutos de cadeira que a unidade tem no horizonte. */
  capacityMinutes: number;
  /** Minutos pedidos por quem está em lista de espera. */
  waitingMinutes: number;
  /** Quantas pessoas estão à espera — para a proposta falar de gente e não só de tempo. */
  waitingPatients: number;
}

export function occupancy(c: ClinicCapacity): number {
  if (!c.capacityMinutes) return 0;
  return Math.max(0, Math.min(1, c.bookedMinutes / c.capacityMinutes));
}

export function freeMinutes(c: ClinicCapacity): number {
  return Math.max(0, c.capacityMinutes - c.bookedMinutes);
}

// ─── Quando é que uma unidade precisa mesmo de ajuda ────────────────────────
// A primeira versão disto comparava minutos à espera com minutos livres, e estava errada
// de uma forma que só se vê com números reais: a capacidade de uma clínica num horizonte
// de duas semanas são dezenas de milhares de minutos, e nenhuma lista de espera lhe chega
// ao tornozelo. Resultado: `waiting - free` dava zero em toda a parte e a funcionalidade
// nunca disparava — o pior tipo de erro, porque o ecrã fica bonito e vazio e ninguém
// desconfia.
//
// O que um gestor de grupo olha não é aritmética de minutos: é «o Porto está a 90% com
// gente à espera e Lisboa está a 45%». A lista de espera é, empiricamente, procura que
// NÃO foi servida — se a unidade a pudesse absorver, já a tinha absorvido. Por isso a
// procura por satisfazer é a lista inteira, e a pergunta que a qualifica é se a unidade
// está de facto cheia.
export const BUSY_OCCUPANCY = 0.75;

/** Procura por satisfazer: a lista de espera de uma unidade que está cheia. */
export function unmetDemand(c: ClinicCapacity): number {
  return occupancy(c) >= BUSY_OCCUPANCY ? Math.max(0, c.waitingMinutes) : 0;
}

/**
 * Capacidade a sobrar: o tempo livre de uma unidade que NÃO está cheia, descontada a
 * própria lista de espera dela. Uma clínica não empresta capacidade de que precisa.
 */
export function spareCapacity(c: ClinicCapacity): number {
  if (occupancy(c) >= BUSY_OCCUPANCY) return 0;
  return Math.max(0, freeMinutes(c) - c.waitingMinutes);
}

export interface CapacityImbalance {
  fromTenantId: string;
  fromName: string;
  toTenantId: string;
  toName: string;
  /** Minutos que se poderiam mover da lista de espera de uma para a agenda da outra. */
  movableMinutes: number;
  /** Pessoas que isso representa, pelo tempo médio pedido na origem. */
  movablePatients: number;
}

// Emparelha quem tem procura a mais com quem tem capacidade a mais, do maior desequilíbrio
// para o menor, e cada minuto só é prometido uma vez — a mesma disciplina de alocação de
// buildGapFillMoves em lib/scheduleOptimizerCalc.ts. Sem ela, três clínicas com procura
// receberiam todas a mesma hora livre da quarta, e a soma prometeria o triplo do que
// existe.
export function findImbalances(clinics: ClinicCapacity[], minMovableMinutes = 60): CapacityImbalance[] {
  const comProcura = clinics
    .map((c) => ({ c, value: unmetDemand(c) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
  const comFolga = clinics
    .map((c) => ({ c, value: spareCapacity(c) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const out: CapacityImbalance[] = [];
  for (const procura of comProcura) {
    let porColocar = procura.value;
    // Tempo médio pedido por pessoa nesta clínica, para converter minutos em gente sem
    // inventar um número fixo. Uma clínica de ortodontia e uma de higiene não têm a
    // mesma consulta média.
    const minutosPorDoente = procura.c.waitingPatients > 0 ? procura.c.waitingMinutes / procura.c.waitingPatients : 0;

    for (const folga of comFolga) {
      if (porColocar < minMovableMinutes) break;
      if (folga.value < minMovableMinutes) continue;
      if (folga.c.tenantId === procura.c.tenantId) continue;

      const mover = Math.min(porColocar, folga.value);
      out.push({
        fromTenantId: procura.c.tenantId,
        fromName: procura.c.name,
        toTenantId: folga.c.tenantId,
        toName: folga.c.name,
        movableMinutes: mover,
        movablePatients: minutosPorDoente > 0 ? Math.floor(mover / minutosPorDoente) : 0,
      });
      folga.value -= mover;
      porColocar -= mover;
    }
  }
  // Maior primeiro: é a ordem por que alguém age sobre isto.
  return out.sort((a, b) => b.movableMinutes - a.movableMinutes);
}

// ─── 2. O que isso vale ─────────────────────────────────────────────────────
// Minutos convertidos a euros pela receita por hora de cadeira da clínica que RECEBE —
// é lá que o trabalho vai ser feito, e é a receita dela que muda. Usar a da origem daria
// o valor que a clínica com a lista de espera não vai receber, que é outra pergunta.
export function imbalanceValueEur(movableMinutes: number, revenuePerHourAtDestination: number | null): number | null {
  if (revenuePerHourAtDestination == null || !Number.isFinite(revenuePerHourAtDestination)) return null;
  return Math.round((movableMinutes / 60) * revenuePerHourAtDestination * 100) / 100;
}

// ─── 3. Quem pode mesmo ser contactado ──────────────────────────────────────
// A conta acima é sobre minutos e não sabe nada de pessoas. Esta é sobre pessoas, e tem
// duas condições que não se substituem uma à outra:
//
//   • a CLÍNICA declarou base legal para transferir (tenants.group_transfers_enabled,
//     migração 063) — é sobre o responsável pelo tratamento;
//   • o DOENTE consentiu ser contactado por outra unidade — é sobre ele.
//
// Faltando qualquer uma, a oportunidade continua a aparecer no ecrã do grupo e não se age
// sobre ela. É a diferença entre «não podemos fazer isto» e «não sabemos que isto
// existe», e só a primeira é uma decisão.
export interface TransferEligibility {
  clinicAllowsTransfers: boolean;
  patientConsented: boolean;
}

export function canOfferAcrossClinics(e: TransferEligibility): { ok: boolean; reason: string } {
  if (!e.clinicAllowsTransfers) {
    return {
      ok: false,
      reason: 'A clínica de origem não declarou base legal para propor consultas noutra unidade do grupo.',
    };
  }
  if (!e.patientConsented) {
    return { ok: false, reason: 'O doente não consentiu ser contactado por outra unidade do grupo.' };
  }
  return { ok: true, reason: '' };
}

// ─── 4. Somar previsões ─────────────────────────────────────────────────────
// Os totais somam-se; as percentagens não. Somar taxas de falta de cinco clínicas e
// dividir por cinco dá a média das clínicas e não a taxa do grupo — uma unidade com
// trinta consultas pesaria o mesmo que uma com trezentas. É o mesmo erro que sumMargins
// evita em lib/costingCalc.ts, e por isso a ponderação é explícita.
export interface ClinicSeries {
  tenantId: string;
  name: string;
  /** Valor previsto para o horizonte. */
  value: number;
  /** Se a série da clínica tinha história suficiente (isReliable de lib/forecastCalc.ts). */
  reliable: boolean;
}

export interface GroupAggregate {
  total: number;
  /** Clínicas cuja série não é de confiança — contadas para o total mesmo assim, e ditas. */
  unreliableClinics: string[];
  contributors: number;
}

export function aggregateForecast(series: ClinicSeries[]): GroupAggregate {
  return {
    total: Math.round(series.reduce((sum, s) => sum + (Number(s.value) || 0), 0) * 100) / 100,
    // Excluir as pouco fiáveis daria um total mais baixo com ar de mais rigoroso. Entram
    // e vão nomeadas, que é o mesmo que lib/forecast.ts faz por clínica.
    unreliableClinics: series.filter((s) => !s.reliable).map((s) => s.name),
    contributors: series.length,
  };
}

export function weightedRate(parts: Array<{ numerator: number; denominator: number }>): number | null {
  const den = parts.reduce((s, p) => s + (Number(p.denominator) || 0), 0);
  if (den <= 0) return null;
  const num = parts.reduce((s, p) => s + (Number(p.numerator) || 0), 0);
  return num / den;
}
