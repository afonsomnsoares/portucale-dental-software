import Anthropic from '@anthropic-ai/sdk';
import type { NextRequest } from 'next/server';
import { forbidden, getAuth, requireSameOrigin, scopeTenant, unauthorized } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { computeClinicComparison, computeClinicSummary } from '@/lib/reports';

function clampDate(s: unknown) {
  const v = String(s || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

const SYSTEM_SINGLE = `És um analista de negócio para clínicas dentárias. Recebes métricas já calculadas de UMA clínica (em JSON) — nunca as inventes nem recalcules, usa só o que te é dado. Escreve um diagnóstico curto em português europeu (máximo 3 frases, sem markdown) que identifique a causa principal do desempenho do período: aquisição de novos pacientes, conversão de orçamentos em tratamentos, eficiência da agenda (ocupação/no-show), ou cobrança. Cita sempre os números concretos que sustentam a conclusão.`;

const SYSTEM_COMPARE = `És um analista de negócio para grupos de clínicas dentárias. Recebes métricas já calculadas (em JSON) comparando várias clínicas do mesmo grupo — nunca as inventes nem recalcules. Escreve um diagnóstico curto em português europeu (máximo 3 frases, sem markdown) que identifique a clínica com pior desempenho e a causa provável (conversão, aquisição, agenda ou cobrança), citando os números e o valor em euros da diferença ("gap") fornecido.`;

export async function POST(request: NextRequest) {
  const originCheck = requireSameOrigin(request);
  if (originCheck) return originCheck;
  const user = getAuth(request);
  if (!user) return unauthorized();
  if (!(await hasPermission(user, 'reports:read'))) return forbidden();

  const body = await request.json().catch(() => ({}));
  const from = clampDate(body.from) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = clampDate(body.to) || new Date().toISOString().slice(0, 10);
  const requestedTenantId = body.tenantId ? String(body.tenantId) : null;
  const tenantId = scopeTenant(user, request, requestedTenantId);

  // No key configured: degrade gracefully (same pattern as the SMS integration in
  // app/api/jobs/run/route.ts) instead of erroring the whole reports page.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ insight: null, configured: false });
  }

  let system: string;
  let payload: unknown;
  if (tenantId) {
    const summary = await computeClinicSummary(tenantId, from, to);
    if (!summary) return Response.json({ error: 'Not found' }, { status: 404 });
    system = SYSTEM_SINGLE;
    payload = {
      clinica: summary.tenant.name,
      periodo: summary.range,
      receita: summary.metrics.completedValue,
      tendenciaReceita: summary.previous.revenueTrend,
      ocupacao: summary.metrics.chairUtilization,
      taxaNoShow: summary.metrics.noShowRate,
      tendenciaNoShow: summary.previous.noShowTrend,
      novosPacientes: summary.metrics.newPatients,
      planosApresentados: summary.metrics.presentedValue,
      planosAceites: summary.metrics.acceptedValue,
      taxaConversaoPlanos: summary.metrics.planConversionRate,
      tendenciaConversao: summary.previous.conversionTrend,
      receitaPotencialPerdida: summary.metrics.recoveryPotential,
      saldoEmDivida: summary.metrics.outstandingBalance,
    };
  } else {
    // Comparing across clinics only makes sense for the super_admin — same gate as
    // GET /api/reports/compare.
    if (user.role !== 'super_admin') return forbidden();
    system = SYSTEM_COMPARE;
    payload = await computeClinicComparison(from, to);
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 500,
      thinking: { type: 'adaptive' },
      system,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
    return Response.json({ insight: textBlock?.text || null, configured: true });
  } catch (e) {
    let message = 'Falha ao gerar análise';
    if (e instanceof Anthropic.RateLimitError)
      message = 'Limite de pedidos à IA atingido — tenta novamente dentro de momentos.';
    else if (e instanceof Anthropic.AuthenticationError) message = 'Chave da API da Claude inválida.';
    else {
      // Don't forward the raw SDK/error message to the client — it can carry
      // internal detail (request ids, upstream error bodies). Log it
      // server-side and return the generic fallback instead.
      console.error('reports/insight: Anthropic call failed:', e instanceof Error ? e.message : e);
    }
    return Response.json({ insight: null, configured: true, error: message }, { status: 502 });
  }
}
