import { computeScheduleOptimization } from '../scheduleOptimizer';
import { callAgentTool } from './aiClient';
import { type AiInsight, clampInsights } from './insightCalc';
import { aiActor, replaceOpenInsights } from './insights';

// O agente Agenda. O trabalho pesado já era determinístico e continua a ser:
// lib/scheduleOptimizer.ts calcula buracos, dentistas por atribuir, equipamento em
// conflito e preferências violadas, e devolve uma lista de propostas (moves). O que
// faltava era julgamento: a lista sai ordenada por minutos recuperados, o que faz de
// um buraco de 90 minutos daqui a duas semanas uma prioridade maior do que um dentista
// por atribuir amanhã de manhã — e não é.
//
// É isso que a IA acrescenta aqui: lê as propostas já calculadas (nunca as recalcula,
// nunca inventa uma marcação) e escreve o que realmente vale a pena atacar primeiro e
// porquê. Não move nada: mudar uma consulta obriga a avisar o doente, e essa decisão é
// de quem atende — a mesma fronteira que app/api/schedule-intel/optimizer/route.ts já
// tinha antes de existir agente nenhum.
const AGENT_ID = 'scheduling';
const ACTOR = aiActor('Agenda');
const WINDOW_DAYS = 14;

// Tipos de conclusão que este agente pode tirar. Lista fechada: a IA classifica dentro
// do que a página sabe mostrar (ver lib/agents/insightCalc.ts).
const KINDS = ['occupancy_gap', 'unassigned_dentist', 'equipment_conflict', 'preference_mismatch', 'waitlist_fit'];

const SYSTEM_PROMPT = `És o agente de agenda de uma clínica dentária. Recebes uma lista de propostas de otimização JÁ CALCULADAS (em JSON) para as próximas duas semanas — buracos na agenda, consultas sem dentista atribuído, conflitos de equipamento, preferências de doente violadas e doentes em lista de espera que encaixam num buraco.

Nunca inventes propostas, consultas ou doentes fora desta lista, e nunca recalcules os minutos — já vêm apurados.

A tua função é priorizar e explicar: escreve no máximo 5 conclusões, em português europeu, dizendo o que atacar primeiro e porquê. Prioriza pela combinação de urgência (quanto falta para a data) e ganho real, não só pelos minutos: uma consulta sem dentista amanhã é mais urgente do que um buraco maior daqui a dez dias. Cita sempre os números concretos (minutos, datas, nomes) que vêm no JSON.

Usa severity "critical" só para o que rebenta se ninguém agir nas próximas 48h, "warning" para perda de capacidade relevante, "info" para o resto. Em impactEur não inventes: só o preenche se o JSON trouxer um valor em euros.`;

export async function reviewSchedule(tenantId: string) {
  const optimization = await computeScheduleOptimization(tenantId, WINDOW_DAYS);
  if (!optimization.moves.length) return { insights: 0, configured: true as const };

  const result = await callAgentTool<{ insights?: AiInsight[] }>({
    agent: 'schedulingAgent',
    system: SYSTEM_PROMPT,
    payload: {
      janelaDias: optimization.windowDays,
      totais: optimization.totals,
      propostas: optimization.moves.map((m) => ({
        tipo: m.kind,
        titulo: m.title,
        detalhe: m.detail,
        minutosRecuperados: m.gainMinutes,
        data: m.date || null,
        doente: m.patientName || null,
      })),
    },
    tool: {
      name: 'submit_schedule_review',
      description: 'Regista as conclusões priorizadas sobre a agenda desta clínica.',
      input_schema: {
        type: 'object',
        properties: {
          insights: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: KINDS },
                severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
                title: { type: 'string' },
                body: { type: 'string' },
              },
              required: ['kind', 'severity', 'title', 'body'],
            },
          },
        },
        required: ['insights'],
      },
    },
  });

  if (result.status === 'unconfigured') return { insights: 0, configured: false as const };
  if (result.status === 'failed') return { insights: 0, configured: true as const };

  // Sem valor monetário nesta análise (a agenda mede-se em minutos), por isso o teto de
  // impactEur é 0 — qualquer euro que a IA escrevesse aqui seria inventado.
  const insights = clampInsights(result.input.insights, { allowedKinds: KINDS, maxImpactEur: 0, maxItems: 5 });
  if (!insights.length) return { insights: 0, configured: true as const };

  return { ...(await replaceOpenInsights(tenantId, AGENT_ID, insights, ACTOR)), configured: true as const };
}
