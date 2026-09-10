import { query } from '../db';
import { callAgentTool } from './aiClient';
import { type AiInsight, clampInsights } from './insightCalc';
import { aiActor, replaceOpenInsights } from './insights';

// O agente Doente. Os quatro jobs determinísticos que já governava (assignTasks,
// planFollowup, recallOutreach, lifecycleOutreach) continuam a correr como sempre —
// esses tratam de cada doente isoladamente, um de cada vez, por regra fixa.
//
// O que faltava, e é o que a IA acrescenta aqui, é a leitura do conjunto: quantos
// doentes estão parados a meio de um tratamento, quantos saíram de uma consulta sem
// próxima marcada, há quanto tempo é que o plano mais antigo está por aceitar. Isto
// existia como fases de um quadro (lib/patientJourneyCalc.ts) mas ninguém olhava para
// os totais nem dizia o que fazer com eles.
//
// Não contacta ninguém: quem fala com doentes são os jobs de outreach acima, que já
// respeitam o consentimento (lib/commPrefs.ts). Este agente escreve conclusões para
// quem gere a clínica ler.
const AGENT_ID = 'patient';
const ACTOR = aiActor('Doente');

const KINDS = ['stalled_treatment', 'no_next_appointment', 'plan_awaiting_decision', 'recall_overdue', 'dormant'];

const SYSTEM_PROMPT = `És o agente de acompanhamento de doentes de uma clínica dentária. Recebes contagens JÁ CALCULADAS (em JSON) sobre a carteira de doentes: tratamentos começados e parados, doentes sem próxima consulta marcada, planos apresentados à espera de decisão (e há quantos dias está o mais antigo), recalls vencidos e doentes dormentes.

Nunca inventes números nem recalcules nada — usa só o que te é dado. Nunca nomeies doentes: recebes contagens, não fichas.

Escreve no máximo 4 conclusões, em português europeu, sobre onde é que a carteira está a perder continuidade e o que fazer a seguir. Cita sempre os números concretos. Se um valor em euros vier no JSON (valor de planos por decidir), podes usá-lo em impactEur; caso contrário deixa-o vazio.

Usa severity "critical" só quando o número representa uma rutura clara de seguimento clínico, "warning" para perda de continuidade relevante, "info" para o resto.`;

export async function reviewPatients(tenantId: string) {
  // Uma query só, com os factos que interessam — as mesmas condições que
  // lib/patientJourney.ts usa para montar o quadro, mas agregadas em vez de por doente
  // (a IA recebe totais, nunca a carteira toda: menos custo e nenhum dado pessoal a sair
  // daqui).
  const [facts] = await query(
    `SELECT
       COUNT(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM treatments t WHERE t.patient_id=p.id AND t.status='accepted')
           AND NOT EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.patient_id=p.id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
           )
       )::int AS tratamentos_parados,
       COUNT(*) FILTER (
         WHERE p.visit_count > 0
           AND NOT EXISTS (
             SELECT 1 FROM appointments a
             WHERE a.patient_id=p.id AND a.appt_date >= CURRENT_DATE AND a.status <> 'no-show'
           )
       )::int AS sem_proxima_consulta,
       COUNT(*) FILTER (
         WHERE EXISTS (SELECT 1 FROM treatment_plans tp WHERE tp.patient_id=p.id AND tp.approved = FALSE)
       )::int AS planos_por_decidir,
       COUNT(*) FILTER (
         WHERE EXISTS (
           SELECT 1 FROM recalls r WHERE r.patient_id=p.id AND r.active = TRUE AND r.next_due < CURRENT_DATE
         )
       )::int AS recalls_vencidos,
       COUNT(*) FILTER (
         WHERE p.visit_count > 0 AND p.last_visit IS NOT NULL AND p.last_visit < CURRENT_DATE - INTERVAL '18 months'
       )::int AS dormentes,
       COUNT(*)::int AS total_doentes
     FROM patients p
     WHERE p.tenant_id = $1 AND p.status <> 'anonymized'`,
    [tenantId],
  );

  const [planValue] = await query(
    `SELECT COALESCE(SUM(total_fee),0)::numeric AS valor_planos_por_decidir,
            MIN(created_at) AS plano_mais_antigo
     FROM treatment_plans
     WHERE tenant_id=$1 AND approved = FALSE`,
    [tenantId],
  );

  const openPlanValue = Number(planValue?.valor_planos_por_decidir || 0);
  const oldestPlanDays = planValue?.plano_mais_antigo
    ? Math.floor((Date.now() - new Date(planValue.plano_mais_antigo).getTime()) / 86400000)
    : null;

  // Nada a dizer numa clínica sem doentes ou sem nenhum sinal — não vale a chamada.
  const signals =
    Number(facts.tratamentos_parados) +
    Number(facts.sem_proxima_consulta) +
    Number(facts.planos_por_decidir) +
    Number(facts.recalls_vencidos) +
    Number(facts.dormentes);
  if (!signals) return { insights: 0, configured: true as const };

  const result = await callAgentTool<{ insights?: AiInsight[] }>({
    agent: 'patientAgent',
    tenantId,
    system: SYSTEM_PROMPT,
    payload: {
      totalDoentes: Number(facts.total_doentes),
      tratamentosParados: Number(facts.tratamentos_parados),
      semProximaConsulta: Number(facts.sem_proxima_consulta),
      planosPorDecidir: Number(facts.planos_por_decidir),
      valorPlanosPorDecidirEur: openPlanValue,
      diasDoPlanoMaisAntigo: oldestPlanDays,
      recallsVencidos: Number(facts.recalls_vencidos),
      dormentes: Number(facts.dormentes),
    },
    tool: {
      name: 'submit_patient_review',
      description: 'Regista as conclusões sobre a continuidade de seguimento da carteira de doentes.',
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
                impactEur: { type: 'number' },
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

  // O único euro que este agente viu foi o valor dos planos por decidir — é esse o teto.
  const insights = clampInsights(result.input.insights, {
    allowedKinds: KINDS,
    maxImpactEur: openPlanValue,
    maxItems: 4,
  });
  if (!insights.length) return { insights: 0, configured: true as const };

  return { ...(await replaceOpenInsights(tenantId, AGENT_ID, insights, ACTOR)), configured: true as const };
}
