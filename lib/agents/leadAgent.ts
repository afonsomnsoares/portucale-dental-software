import { appendAudit } from '../audit';
import type { SessionUser } from '../auth';
import { query } from '../db';
import { callAgentTool } from './aiClient';
import { type AiInsight, clampInsights } from './insightCalc';
import { replaceOpenInsights } from './insights';
import { clampLeadTriage, type LeadContact } from './leadAgentCalc';

// O agente Lead, segundo dos sete de lib/agents/registry.ts com IA realmente ligada.
// Qualifica um lead novo (hot/warm/cold), descreve a intenção, e escreve o rascunho da
// resposta — mas ao contrário do agente Operações, NUNCA envia nada sozinho:
//   1. Só qualifica leads da lista de candidatos (status='open', ainda não triados —
//      nunca reprocessa um lead já triado, mesmo que o corram outra vez).
//   2. O canal do rascunho (sms/email) nunca é escolhido pela IA — é calculado a partir
//      do contacto real do lead (ver leadAgentCalc.ts), para que a IA nunca "escolha" um
//      canal que o lead não deixou.
//   3. Escreve ai_draft_reply e para aí. Sair do rascunho para uma mensagem real enviada
//      exige uma pessoa em app/api/leads/[id]/send-reply/route.ts — mandar uma mensagem
//      automática a alguém de fora da clínica sem revisão é um risco de RGPD que este
//      projeto não assume sozinho (ver a conversa que decidiu isto).
//   4. Sem ANTHROPIC_API_KEY, ou se a chamada falhar, simplesmente não triagem nada nesta
//      corrida — ao contrário da reposição de stock, não há uma regra fixa equivalente
//      para cair de fallback: a qualificação e o rascunho SÃO o valor deste agente, não
//      há versão determinística honesta disso para fingir.
export const AI_ACTOR: Pick<SessionUser, 'id' | 'name' | 'role' | 'clinic'> = {
  id: '',
  name: 'Agente IA — Lead',
  role: 'system',
  clinic: 'System',
};

// Mesmo raciocínio do MAX_CANDIDATES de reorderAgent.ts: custo, não segurança — o espaço
// de candidatos já é só leads abertos e nunca triados.
const MAX_CANDIDATES = 20;

const SYSTEM_PROMPT = `És o agente de qualificação de leads de uma clínica dentária. Recebes uma lista de leads novos (em JSON) — nome, telefone/email (só indica se existem, nunca o valor), origem e notas de quem os registou.

Para cada lead, decide:
- qualification: "hot" (interesse claro, pronto a marcar), "warm" (interessado mas hesitante ou sem pressa) ou "cold" (contacto genérico, pouca intenção clara).
- intent: uma frase curta em português europeu com o que a pessoa provavelmente quer.
- draftReply: uma mensagem curta (2-3 frases), calorosa e profissional, em português europeu, a agradecer o contacto e a propor o próximo passo (normalmente marcar uma consulta). Nunca inventes preços, disponibilidade de datas concretas, ou diagnósticos — a mensagem convida a continuar a conversa, não substitui uma pessoa.

Esta mensagem é sempre revista por uma pessoa antes de ser enviada — nunca sai diretamente de ti.`;

export async function triageOpenLeads(tenantId: string) {
  const leads = await query(
    `SELECT id, name, phone, email, source, notes
     FROM leads
     WHERE tenant_id=$1 AND status='open' AND ai_triaged_at IS NULL
     ORDER BY created_at
     LIMIT $2`,
    [tenantId, MAX_CANDIDATES],
  );
  if (!leads.length) return { triaged: 0, configured: true as const };

  const candidates = new Map<string, LeadContact>(
    leads.map((l) => [String(l.id), { hasPhone: !!l.phone, hasEmail: !!l.email }]),
  );
  const result = await callAgentTool<{ leads?: unknown[] }>({
    agent: 'leadAgent.triage',
    system: SYSTEM_PROMPT,
    payload: leads.map((l) => ({
      leadId: l.id,
      name: l.name,
      hasPhone: !!l.phone,
      hasEmail: !!l.email,
      source: l.source || null,
      notes: l.notes || null,
    })),
    tool: {
      name: 'submit_lead_triage',
      description: 'Regista a qualificação e o rascunho de resposta para cada lead desta lista.',
      input_schema: {
        type: 'object',
        properties: {
          leads: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                leadId: { type: 'string' },
                qualification: { type: 'string', enum: ['hot', 'warm', 'cold'] },
                intent: { type: 'string' },
                draftReply: { type: 'string' },
              },
              required: ['leadId', 'qualification', 'draftReply'],
            },
          },
        },
        required: ['leads'],
      },
    },
  });

  if (result.status === 'unconfigured') return { triaged: 0, configured: false as const };
  if (result.status === 'failed') return { triaged: 0, configured: true as const };

  const items = clampLeadTriage(candidates, (result.input.leads || []) as never);

  for (const it of items) {
    await query(
      `UPDATE leads
       SET ai_qualification=$1, ai_intent=$2, ai_draft_channel=$3, ai_draft_reply=$4, ai_triaged_at=NOW()
       WHERE id=$5 AND tenant_id=$6`,
      [it.qualification, it.intent || null, it.draftChannel, it.draftReply, it.leadId, tenantId],
    );
  }
  if (items.length) {
    await appendAudit(
      AI_ACTOR,
      'UPDATE',
      `Leads triados por IA: ${items.length} ${items.length === 1 ? 'lead' : 'leads'}`,
      null,
      items.map((i) => i.qualification).join(', '),
      AI_ACTOR.clinic,
    );
  }
  return { triaged: items.length, configured: true as const };
}

// ─── Follow-up de leads frios ───────────────────────────────────────────────────
// Um lead que recebeu resposta e não deu sinal continua 'open' para sempre: ninguém
// volta lá, e ao fim de umas semanas ninguém se lembra de que existiu. Isto encontra
// esses e escreve um segundo rascunho — de novo, só rascunho: reabrir uma conversa com
// alguém de fora da clínica tem exatamente o mesmo problema de consentimento que a
// primeira resposta tinha, por isso passa pela mesma porta
// (app/api/leads/[id]/send-reply/route.ts, com uma pessoa a decidir).
//
// COLD_AFTER_DAYS é deliberadamente generoso: um lead que respondeu ontem não é frio, e
// insistir cedo demais é a diferença entre acompanhar e importunar.
const COLD_AFTER_DAYS = 14;

const FOLLOWUP_SYSTEM_PROMPT = `És o agente de leads de uma clínica dentária. Recebes leads (em JSON) que já receberam uma resposta há algumas semanas e nunca mais deram sinal — não marcaram, não responderam, não foram fechados.

Para cada um, escreve em draftReply uma mensagem curta (2 frases), em português europeu, para reabrir a conversa sem pressão: reconhece que já falaram, deixa a porta aberta, e propõe um passo simples. Nunca inventes preços, datas concretas ou diagnósticos, e nunca insinues urgência clínica que não te foi dada.

Mantém a qualification que o lead já tinha, a não ser que o tempo decorrido a justifique baixar. Esta mensagem é sempre revista por uma pessoa antes de sair.`;

export async function followUpColdLeads(tenantId: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { drafted: 0, configured: false as const };

  const leads = await query(
    `SELECT id, name, phone, email, source, notes, ai_qualification, ai_intent,
            ai_reply_sent_at::date::text AS respondido_em
     FROM leads
     WHERE tenant_id=$1 AND status='open'
       AND ai_reply_sent_at IS NOT NULL
       AND ai_reply_sent_at < NOW() - ($2::int * INTERVAL '1 day')
     ORDER BY ai_reply_sent_at
     LIMIT $3`,
    [tenantId, COLD_AFTER_DAYS, MAX_CANDIDATES],
  );
  if (!leads.length) return { drafted: 0, configured: true as const };

  const candidates = new Map<string, LeadContact>(
    leads.map((l) => [String(l.id), { hasPhone: !!l.phone, hasEmail: !!l.email }]),
  );

  const result = await callAgentTool<{ leads?: unknown[] }>({
    agent: 'leadAgent.followUp',
    system: FOLLOWUP_SYSTEM_PROMPT,
    payload: leads.map((l) => ({
      leadId: l.id,
      name: l.name,
      source: l.source || null,
      qualificacaoAnterior: l.ai_qualification,
      intencaoAnterior: l.ai_intent,
      respondidoEm: l.respondido_em,
    })),
    tool: {
      name: 'submit_lead_followup',
      description: 'Regista o rascunho de reabertura de conversa para cada lead frio.',
      input_schema: {
        type: 'object',
        properties: {
          leads: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                leadId: { type: 'string' },
                qualification: { type: 'string', enum: ['hot', 'warm', 'cold'] },
                intent: { type: 'string' },
                draftReply: { type: 'string' },
              },
              required: ['leadId', 'qualification', 'draftReply'],
            },
          },
        },
        required: ['leads'],
      },
    },
  });

  if (result.status !== 'ok') {
    return { drafted: 0, configured: result.status === 'failed' };
  }

  const items = clampLeadTriage(candidates, (result.input.leads || []) as never);
  for (const it of items) {
    // ai_reply_sent_at volta a NULL: há um rascunho novo por enviar, e é isso que a
    // página mostra. O envio anterior fica no audit_log, que é onde o histórico vive.
    await query(
      `UPDATE leads
       SET ai_qualification=$1, ai_intent=$2, ai_draft_channel=$3, ai_draft_reply=$4,
           ai_triaged_at=NOW(), ai_reply_sent_at=NULL
       WHERE id=$5 AND tenant_id=$6`,
      [it.qualification, it.intent || null, it.draftChannel, it.draftReply, it.leadId, tenantId],
    );
  }
  if (items.length) {
    await appendAudit(
      AI_ACTOR,
      'UPDATE',
      `Follow-up de leads frios: ${items.length} ${items.length === 1 ? 'rascunho' : 'rascunhos'}`,
      null,
      'draft',
      AI_ACTOR.clinic,
    );
  }
  return { drafted: items.length, configured: true as const };
}

// ─── Conversão por origem ───────────────────────────────────────────────────────
// A contagem bruta por origem já existia (leads.source, lead_capture_sources.lead_count),
// mas contar leads não diz nada: a origem que traz 200 contactos e converte 2% é pior do
// que a que traz 20 e converte 40%. Isto calcula a taxa real por origem e deixa a IA
// dizer onde é que vale a pena investir — escrito em agent_insights como os agentes de
// análise, porque é uma leitura, não uma ação.
const SOURCE_KINDS = ['source_performance', 'source_volume', 'source_waste'];

const SOURCE_SYSTEM_PROMPT = `És o agente de leads de uma clínica dentária. Recebes, por origem de lead (em JSON), quantos contactos entraram, quantos converteram em doente e a taxa de conversão — tudo JÁ CALCULADO.

Nunca inventes origens nem recalcules taxas. Ignora origens com poucos contactos ao ponto de a taxa não significar nada, e diz isso explicitamente em vez de tirar conclusões de amostras minúsculas.

Escreve no máximo 3 conclusões, em português europeu, sobre onde a clínica deve concentrar ou retirar esforço de aquisição. Cita sempre os números.`;

export async function reviewLeadSources(tenantId: string) {
  const rows = await query(
    `SELECT COALESCE(NULLIF(TRIM(source), ''), 'sem origem') AS origem,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status='converted')::int AS convertidos
     FROM leads
     WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '180 days'
     GROUP BY 1
     ORDER BY total DESC`,
    [tenantId],
  );
  if (!rows.length) return { insights: 0, configured: true as const };

  const result = await callAgentTool<{ insights?: AiInsight[] }>({
    agent: 'leadAgent.sources',
    system: SOURCE_SYSTEM_PROMPT,
    payload: rows.map((r) => ({
      origem: r.origem,
      contactos: Number(r.total),
      convertidos: Number(r.convertidos),
      taxaConversaoPct: Number(r.total) ? Math.round((Number(r.convertidos) / Number(r.total)) * 1000) / 10 : 0,
    })),
    tool: {
      name: 'submit_source_review',
      description: 'Regista as conclusões sobre o desempenho de cada origem de leads.',
      input_schema: {
        type: 'object',
        properties: {
          insights: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: SOURCE_KINDS },
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

  // Sem euros nesta análise: contam-se contactos e taxas, não receita.
  const insights = clampInsights(result.input.insights, {
    allowedKinds: SOURCE_KINDS,
    maxImpactEur: 0,
    maxItems: 3,
  });
  if (!insights.length) return { insights: 0, configured: true as const };

  return { ...(await replaceOpenInsights(tenantId, 'lead', insights, AI_ACTOR)), configured: true as const };
}
