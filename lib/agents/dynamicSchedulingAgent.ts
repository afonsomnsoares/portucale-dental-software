import type { SlotPlan } from '../demandPoolCalc';
import { SOURCE_LABEL_PT } from '../demandPoolCalc';
import { callAgentTool } from './aiClient';

// O passo de julgamento do Dynamic Scheduling.
//
// O trabalho pesado é determinístico e continua a ser: lib/demandPoolCalc.ts
// apura quem cabe em cada espaço e pontua cada par (doente, horário). O que o
// modelo acrescenta é a pergunta que uma pontuação não responde — *destes* que
// cabem, a quem é que vale mesmo a pena telefonar hoje?
//
// Um exemplo concreto do que a pontuação não vê: três candidatos com 60, 58 e
// 57 pontos para a mesma cadeira. A ordem entre eles é ruído numérico. Mas um
// deles é um plano de 900 € parado há dois meses e os outros dois são higienes
// que se voltam a oferecer na semana que vem sem prejuízo nenhum.
//
// ─── A fronteira, que é o que interessa ────────────────────────────────────
//
// O agente só pode ESTREITAR. Escolhe de uma lista fechada de candidatos que o
// cálculo já validou; não inventa doentes, não inventa horários, não altera
// pontuações, não muda a cadeira nem o dentista, e não pode acrescentar quem o
// motor excluiu — quem foi excluído foi-o por um filtro duro (não cabe, não há
// dentista, o equipamento não existe) que uma opinião não desfaz.
//
// Sem ANTHROPIC_API_KEY, ou com a chamada a falhar, o resultado é a escolha
// determinística: os mais bem pontuados. É a mesma decisão do reorderAgent —
// a clínica sem IA configurada não fica sem funcionalidade, fica sem a camada
// de julgamento.

const AGENT_ID = 'scheduling';

const SYSTEM_PROMPT = `És o agente de agenda de uma clínica dentária. Recebes, em JSON, uma lista de ESPAÇOS LIVRES na agenda e, para cada um, os doentes que já foram validados como compatíveis (cabem na duração, há dentista e equipamento, respeitam os prazos). Cada doente traz uma pontuação já calculada e a razão pela qual foi considerado.

A tua função é escolher, para cada espaço, quais destes doentes devem ser contactados agora — e só isso. Nunca acrescentes doentes que não estejam na lista desse espaço, nunca recalcules pontuações, nunca proponhas outro horário, outra cadeira ou outro dentista.

Critérios, por esta ordem:
1. Não desperdiçar um contacto: se um doente é claramente melhor para aquele espaço, contacta-se esse e não a lista toda.
2. Preferir procura que se perde se ninguém agir (um plano de tratamento aceite e parado, um recall muito vencido) sobre procura que se volta a oferecer sem prejuízo (uma higiene de rotina).
3. Preferir quem tem menos risco de faltar quando o resto for equivalente.
4. Se o espaço for grande e os doentes forem de tratamentos curtos, podes escolher mais do que um — mas nunca mais do que o limite indicado.

Escreve a nota de cada escolha em português europeu, numa frase curta, dizendo porque é aquele doente e não outro.`;

export interface AgentSelection {
  openingKey: string;
  candidateKeys: string[];
  note?: string;
}

export interface SelectionResult {
  plans: SlotPlan[];
  /** Como se decidiu: 'ai' ou 'deterministic' (sem chave, falha, ou nada a decidir). */
  decidedBy: 'ai' | 'deterministic';
  notes: Record<string, string>;
}

/**
 * Devolve os mesmos planos, com as ofertas reduzidas ao que se vai contactar.
 * `maxPerSlot` é o teto da política — o agente pode escolher menos, nunca mais.
 */
export async function chooseOffersToContact(plans: SlotPlan[], maxPerSlot: number): Promise<SelectionResult> {
  const deterministic = (): SlotPlan[] =>
    plans.map((p) => ({ opening: p.opening, offers: p.offers.slice(0, maxPerSlot) }));

  if (!plans.length) return { plans: [], decidedBy: 'deterministic', notes: {} };

  // Nada por decidir: se nenhum espaço tem mais candidatos do que vagas de
  // contacto, a escolha do modelo seria a mesma lista. Não se gasta uma chamada
  // (nem se dá a um modelo a oportunidade de tirar alguém sem razão).
  if (plans.every((p) => p.offers.length <= maxPerSlot)) {
    return { plans: deterministic(), decidedBy: 'deterministic', notes: {} };
  }

  const result = await callAgentTool<{ selections?: AgentSelection[] }>({
    agent: 'dynamicSchedulingAgent',
    system: SYSTEM_PROMPT,
    payload: {
      limitePorEspaco: maxPerSlot,
      espacos: plans.map((p) => ({
        espacoId: p.opening.key,
        data: p.opening.date,
        cadeira: p.opening.chair,
        minutosLivres: p.opening.endMinutes - p.opening.startMinutes,
        tipo: p.opening.kind === 'gap' ? 'buraco entre consultas' : 'ponta do dia',
        candidatos: p.offers.map((o) => ({
          candidatoId: o.candidate.key,
          doente: o.candidate.patientName,
          origem: SOURCE_LABEL_PT[o.candidate.source],
          tratamento: o.candidate.treatmentType,
          duracaoMin: o.candidate.durationMinutes,
          pontuacao: o.score,
          valorEur: Math.round(o.candidate.valueEur),
          riscoFaltaPct: Math.round(o.candidate.noShowRisk * 100),
          diasEmAtraso: o.candidate.overdueDays,
          razao: o.reason,
        })),
      })),
    },
    tool: {
      name: 'select_offers',
      description: 'Escolhe que doentes contactar por cada espaço livre da agenda.',
      input_schema: {
        type: 'object',
        properties: {
          selections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                openingKey: { type: 'string' },
                candidateKeys: { type: 'array', items: { type: 'string' } },
                note: { type: 'string' },
              },
              required: ['openingKey', 'candidateKeys'],
            },
          },
        },
        required: ['selections'],
      },
    },
  });

  if (result.status !== 'ok') return { plans: deterministic(), decidedBy: 'deterministic', notes: {} };

  const byOpening = new Map((result.input.selections || []).map((s) => [String(s.openingKey), s]));
  const notes: Record<string, string> = {};
  const chosen: SlotPlan[] = [];

  for (const plan of plans) {
    const selection = byOpening.get(plan.opening.key);
    // Espaço que o modelo não mencionou: fica a escolha determinística. Silêncio
    // não é "não contactar ninguém" — é ausência de opinião, e a ausência de
    // opinião não pode apagar trabalho que o cálculo já validou.
    if (!selection) {
      chosen.push({ opening: plan.opening, offers: plan.offers.slice(0, maxPerSlot) });
      continue;
    }
    const wanted = new Set((selection.candidateKeys || []).map(String));
    // A interseção é a fronteira, escrita como código: o que fica é sempre um
    // subconjunto do que o cálculo produziu, na ordem do cálculo.
    const offers = plan.offers.filter((o) => wanted.has(o.candidate.key)).slice(0, maxPerSlot);
    if (!offers.length) continue;
    if (selection.note) notes[plan.opening.key] = String(selection.note).slice(0, 300);
    chosen.push({ opening: plan.opening, offers });
  }

  return { plans: chosen, decidedBy: 'ai', notes };
}

export { AGENT_ID };
