import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookingPropensityScore,
  CHURN_FUTURE_APPOINTMENT_DAMPENER,
  churnRiskScore,
  clamp01,
  engagementScore,
  monthsRamp,
  outreachPriority,
  recencyScore,
  scoreBand,
  scorePatient,
  smoothedRate,
  topDrivers,
} from '../lib/patientScoringCalc.ts';

test('clamp01 limita e coage', () => {
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01('nada'), 0);
  assert.equal(clamp01(0.25), 0.25);
});

test('monthsRamp sobe entre os dois limites e satura', () => {
  assert.equal(monthsRamp(0, 3, 18), 0);
  assert.equal(monthsRamp(3, 3, 18), 0);
  assert.equal(monthsRamp(18, 3, 18), 1);
  assert.equal(monthsRamp(40, 3, 18), 1);
  assert.ok(monthsRamp(6, 3, 18) > 0 && monthsRamp(6, 3, 18) < 1);
});

// A queixa concreta contra o modelo binário: aos 6 meses o alarme tocava de uma vez.
// Aqui o sinal já existe muito antes, e é estritamente crescente.
test('monthsRamp já tem sinal antes dos 6 meses', () => {
  assert.ok(monthsRamp(4, 3, 18) > 0);
  assert.ok(monthsRamp(5, 3, 18) > monthsRamp(4, 3, 18));
});

test('recencyScore decai de 1 para perto de 0', () => {
  assert.equal(recencyScore(0), 1);
  assert.equal(recencyScore(4), 0.5);
  assert.ok(recencyScore(24) < 0.02);
});

// A razão de existir da suavização: uma falta em duas consultas não é uma taxa de 50%.
test('smoothedRate puxa amostras pequenas para o prior', () => {
  const naive = 1 / 2;
  const smoothed = smoothedRate(1, 2, 0.1);
  assert.ok(smoothed < naive, 'uma falta em duas não pode valer 50%');
  // Com muitas observações a suavização deixa de mandar.
  assert.ok(Math.abs(smoothedRate(50, 100, 0.1) - 0.5) < 0.03);
});

test('smoothedRate sem observações devolve o prior', () => {
  assert.equal(smoothedRate(0, 0, 0.4), 0.4);
});

test('scoreBand usa os mesmos cortes em todo o lado', () => {
  assert.equal(scoreBand(0), 'baixo');
  assert.equal(scoreBand(34), 'baixo');
  assert.equal(scoreBand(35), 'medio');
  assert.equal(scoreBand(60), 'alto');
  assert.equal(scoreBand(100), 'alto');
});

test('topDrivers ignora ruído e ordena por peso', () => {
  const drivers = topDrivers(
    { a: 0.3, b: 0.01, c: 0.1 },
    { a: 'Alfa', b: 'Beta', c: 'Gama' },
  );
  assert.deepEqual(
    drivers.map((d) => d.key),
    ['a', 'c'],
  );
  assert.equal(drivers[0].points, 30);
});

// ─── Engagement ─────────────────────────────────────────────────────────────

// 100 é inatingível de propósito: as taxas são suavizadas (ver smoothedRate), por isso
// nem um historial impecável afirma certeza absoluta. O que se garante é que chega
// perto e que nada o supera.
test('engagementScore aproxima-se de 100 para o doente perfeito', () => {
  const { score } = engagementScore({
    attendedCount: 40,
    scheduledCount: 40,
    monthsSinceLastVisit: 0,
    outreachResponded: 20,
    outreachSent: 20,
    plansAccepted: 10,
    plansPresented: 10,
    paperworkComplete: true,
    hasOverdueBalance: false,
  });
  assert.ok(score >= 90, `esperava >= 90, deu ${score}`);
  assert.ok(score <= 100);
});

test('engagementScore aproxima-se de 0 no pior caso', () => {
  const { score } = engagementScore({
    attendedCount: 0,
    scheduledCount: 60,
    monthsSinceLastVisit: 60,
    outreachResponded: 0,
    outreachSent: 40,
    plansAccepted: 0,
    plansPresented: 20,
    paperworkComplete: false,
    hasOverdueBalance: true,
  });
  assert.ok(score <= 10, `esperava <= 10, deu ${score}`);
});

test('engagementScore pesa a comparência acima de tudo o resto', () => {
  const soPresenca = engagementScore({ attendedCount: 40, scheduledCount: 40 }).contributions.attendance;
  const soPapelada = engagementScore({ paperworkComplete: true }).contributions.paperwork;
  assert.ok(soPresenca > soPapelada);
});

test('engagementScore devolve contribuições explicáveis', () => {
  const { contributions } = engagementScore({ monthsSinceLastVisit: 0, paperworkComplete: true });
  assert.ok(contributions.recency > 0);
  assert.ok(contributions.paperwork > 0);
});

// ─── Risco de abandono ──────────────────────────────────────────────────────

test('churnRiskScore cresce com a ausência, sem degraus', () => {
  const aos3 = churnRiskScore({ monthsSinceLastVisit: 3 }).score;
  const aos6 = churnRiskScore({ monthsSinceLastVisit: 6 }).score;
  const aos12 = churnRiskScore({ monthsSinceLastVisit: 12 }).score;
  assert.ok(aos6 > aos3);
  assert.ok(aos12 > aos6);
});

// O ponto todo do módulo: às 5 meses o modelo binário ainda diz "está tudo bem".
test('churnRiskScore já sinaliza antes dos 6 meses do modelo binário', () => {
  const cedo = churnRiskScore({
    monthsSinceLastVisit: 5,
    recallOverdueMonths: 2,
    noShowCount: 2,
    scheduledCount: 6,
    hasAbandonedTreatment: true,
    consecutiveUnansweredOutreach: 2,
  });
  // O modelo binário de lib/lifecycleCalc.ts ainda chama 'stable' a este doente.
  assert.ok(cedo.score >= 35, `esperava pelo menos risco médio antes dos 6 meses, deu ${cedo.score}`);
});

test('uma consulta marcada amortece o risco sem o anular', () => {
  const inputs = {
    monthsSinceLastVisit: 14,
    noShowCount: 3,
    scheduledCount: 6,
    hasAbandonedTreatment: true,
  };
  const sem = churnRiskScore(inputs).score;
  const com = churnRiskScore({ ...inputs, hasFutureAppointment: true }).score;
  assert.ok(com < sem);
  assert.ok(com > 0, 'histórico mau não desaparece só porque marcou');
  assert.equal(com, Math.round(sem * CHURN_FUTURE_APPOINTMENT_DAMPENER));
});

test('churnRiskScore é 0 para quem veio ontem e nunca falhou', () => {
  const { score } = churnRiskScore({
    monthsSinceLastVisit: 0,
    recallOverdueMonths: 0,
    noShowCount: 0,
    scheduledCount: 30,
    hasAbandonedTreatment: false,
    consecutiveUnansweredOutreach: 0,
    clinicNoShowRate: 0,
  });
  assert.equal(score, 0);
});

// ─── Probabilidade de marcação ──────────────────────────────────────────────

test('bookingPropensityScore é 0 e diz porquê quando não há nada a fazer', () => {
  assert.equal(bookingPropensityScore({ optedOut: true, engagement: 90 }).score, 0);
  assert.equal(bookingPropensityScore({ optedOut: true }).suppressed, 'não autoriza contacto');
  assert.equal(bookingPropensityScore({ hasValidPhone: false }).suppressed, 'sem telefone válido');
  assert.equal(bookingPropensityScore({ hasFutureAppointment: true }).suppressed, 'já tem consulta marcada');
});

test('ter um motivo pendente vale mais do que não ter nenhum', () => {
  const sem = bookingPropensityScore({ engagement: 60, hasValidPhone: true }).score;
  const com = bookingPropensityScore({ engagement: 60, hasValidPhone: true, hasOpenPlan: true }).score;
  assert.ok(com > sem);
});

test('motivos acumulam com retornos decrescentes', () => {
  const base = { engagement: 50, hasValidPhone: true };
  const um = bookingPropensityScore({ ...base, hasOpenPlan: true }).factors.pendingReason;
  const dois = bookingPropensityScore({ ...base, hasOpenPlan: true, recallDue: true }).factors.pendingReason;
  const tres = bookingPropensityScore({
    ...base,
    hasOpenPlan: true,
    recallDue: true,
    hasAbandonedTreatment: true,
  }).factors.pendingReason;
  assert.ok(dois > um);
  assert.ok(tres > dois);
  assert.ok(dois - um > tres - dois, 'o terceiro motivo não pode valer tanto como o segundo');
});

test('uma ausência muito longa reduz a probabilidade de marcação', () => {
  const recente = bookingPropensityScore({ engagement: 70, hasValidPhone: true, monthsSinceLastVisit: 6 }).score;
  const antiga = bookingPropensityScore({ engagement: 70, hasValidPhone: true, monthsSinceLastVisit: 30 }).score;
  assert.ok(antiga < recente);
});

// ─── O conjunto ─────────────────────────────────────────────────────────────

test('scorePatient liga o engagement aos outros dois', () => {
  const bom = scorePatient({
    attendedCount: 20,
    scheduledCount: 20,
    monthsSinceLastVisit: 1,
    paperworkComplete: true,
    hasValidPhone: true,
  });
  const mau = scorePatient({
    attendedCount: 2,
    scheduledCount: 20,
    monthsSinceLastVisit: 20,
    paperworkComplete: false,
    hasOverdueBalance: true,
    hasValidPhone: true,
  });
  assert.ok(bom.engagement.score > mau.engagement.score);
  assert.ok(bom.churnRisk.score < mau.churnRisk.score);
  assert.equal(bom.engagement.band, 'alto');
});

// O caso que justifica os três scores em vez de um: era ótimo e está a desaparecer.
test('um bom doente a desaparecer tem engagement alto E risco alto', () => {
  const s = scorePatient({
    attendedCount: 30,
    scheduledCount: 30,
    plansAccepted: 5,
    plansPresented: 5,
    paperworkComplete: true,
    monthsSinceLastVisit: 14,
    recallOverdueMonths: 5,
    consecutiveUnansweredOutreach: 2,
    hasValidPhone: true,
    recallDue: true,
  });
  assert.equal(s.engagement.band, 'alto', 'o historial dele é bom — é esse o ponto');
  assert.ok(s.churnRisk.score >= 35, `risco devia ser pelo menos médio, deu ${s.churnRisk.score}`);
  assert.ok(s.bookingPropensity.score > 0);
  assert.ok(s.churnRisk.drivers.length > 0);
});

test('outreachPriority põe o recuperável à frente do perdido', () => {
  const recuperavel = scorePatient({
    attendedCount: 25,
    scheduledCount: 26,
    plansAccepted: 4,
    plansPresented: 4,
    paperworkComplete: true,
    monthsSinceLastVisit: 10,
    recallOverdueMonths: 4,
    recallDue: true,
    hasOpenPlan: true,
    hasValidPhone: true,
  });
  const perdido = scorePatient({
    attendedCount: 1,
    scheduledCount: 12,
    noShowCount: 8,
    monthsSinceLastVisit: 40,
    consecutiveUnansweredOutreach: 6,
    hasValidPhone: true,
  });
  assert.ok(
    outreachPriority(recuperavel) > outreachPriority(perdido),
    'ordenar só por risco de abandono põe os casos perdidos no topo — é o erro que isto evita',
  );
});

test('outreachPriority é 0 para quem não pode ser contactado', () => {
  const s = scorePatient({ monthsSinceLastVisit: 20, optedOut: true });
  assert.equal(outreachPriority(s), 0);
});
