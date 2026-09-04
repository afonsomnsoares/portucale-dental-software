import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyContactLimits,
  candidateFits,
  effectiveOpeningStart,
  type DemandCandidate,
  type OpeningSlot,
  planOffers,
  scoreCandidate,
} from '../lib/demandPoolCalc.ts';

const TODAY = '2026-09-03';

function candidate(overrides: Partial<DemandCandidate> = {}): DemandCandidate {
  const source = overrides.source || 'waitlist';
  const sourceId = overrides.sourceId || 'src-1';
  return {
    key: `${source}:${sourceId}`,
    source,
    sourceId,
    patientId: 'p1',
    patientName: 'Ana Ribeiro',
    phone: '+351911111111',
    canSms: true,
    treatmentType: 'Destartarização', // 45 min, sem especialidade nem equipamento
    durationMinutes: 45,
    valueEur: 60,
    overdueDays: 0,
    noShowRisk: 0.1,
    prefs: null,
    maxWaitUntil: null,
    busyDates: [],
    currentAppointmentId: null,
    currentAppointmentDate: null,
    lastContactedAt: null,
    ...overrides,
  };
}

function opening(overrides: Partial<OpeningSlot> = {}): OpeningSlot {
  return {
    key: 'o1',
    chair: 1,
    date: '2026-09-04',
    startMinutes: 14 * 60 + 30,
    endMinutes: 16 * 60,
    kind: 'gap',
    equipmentTags: [],
    dentists: [
      {
        dentistId: 'd1',
        dentistName: 'Dr. Silva',
        specialties: [],
        freeFrom: 9 * 60,
        freeTo: 19 * 60,
      },
    ],
    ...overrides,
  };
}

// ─── Filtros duros ─────────────────────────────────────────────────────────

test('candidateFits accepts a plain fit and picks a dentist', () => {
  const fit = candidateFits(candidate(), opening(), TODAY);
  assert.equal(fit.ok, true);
  assert.equal(fit.dentist?.dentistId, 'd1');
  assert.equal(fit.startMinutes, 14 * 60 + 30);
});

test('candidateFits rejects an opening shorter than the procedure', () => {
  const fit = candidateFits(candidate({ durationMinutes: 120 }), opening(), TODAY);
  assert.equal(fit.ok, false);
  assert.match(fit.blockers.join(' '), /espaço curto/);
});

test('candidateFits rejects an opening in the past', () => {
  assert.equal(candidateFits(candidate(), opening({ date: '2026-09-01' }), TODAY).ok, false);
});

test('candidateFits respects the deadline the patient accepted', () => {
  assert.equal(candidateFits(candidate({ maxWaitUntil: '2026-09-03' }), opening(), TODAY).ok, false);
});

test('candidateFits never offers a second appointment on a day the patient already has one', () => {
  const fit = candidateFits(candidate({ busyDates: ['2026-09-04'] }), opening(), TODAY);
  assert.equal(fit.ok, false);
  assert.match(fit.blockers.join(' '), /já tem consulta nesse dia/);
});

test('candidateFits requires a chair carrying the equipment the procedure needs', () => {
  const endo = candidate({ treatmentType: 'Endodontia', durationMinutes: 60 });
  assert.equal(candidateFits(endo, opening(), TODAY).ok, false);
  assert.equal(candidateFits(endo, opening({ equipmentTags: ['endo_motor'] }), TODAY).ok, true);
});

test('candidateFits requires a dentist with the specialty the procedure needs', () => {
  const ortho = candidate({ treatmentType: 'Consulta de Ortodontia', durationMinutes: 30 });
  assert.equal(candidateFits(ortho, opening(), TODAY).ok, false);
  const withSpecialist = opening({
    dentists: [
      { dentistId: 'd2', dentistName: 'Dra. Costa', specialties: ['Ortodontia'], freeFrom: 8 * 60, freeTo: 20 * 60 },
    ],
  });
  assert.equal(candidateFits(ortho, withSpecialist, TODAY).ok, true);
});

test('candidateFits rejects a dentist whose shift does not cover the whole appointment', () => {
  const tight = opening({
    dentists: [{ dentistId: 'd1', dentistName: 'Dr. Silva', specialties: [], freeFrom: 9 * 60, freeTo: 15 * 60 }],
  });
  // 14:30 + 45 min = 15:15, e o dentista sai às 15:00.
  assert.equal(candidateFits(candidate(), tight, TODAY).ok, false);
});

// A regra que separa este motor de lib/waitlistMatch.ts: ali a preferência
// filtra (o doente escreveu o que aceitava), aqui pontua.
test('candidateFits does not use patient preferences as a filter', () => {
  const picky = candidate({
    prefs: { preferredDentistId: null, preferredDays: [1], preferredTimeStart: '08:00', preferredTimeEnd: '10:00' },
  });
  const fit = candidateFits(picky, opening(), TODAY); // sexta-feira, 14:30
  assert.equal(fit.ok, true);
  assert.ok(scoreCandidate(picky, opening(), fit).preferenceViolations.length > 0);
});

test('candidateFits prefers the dentist the patient asked for, when available', () => {
  const two = opening({
    dentists: [
      { dentistId: 'd1', dentistName: 'Dr. Silva', specialties: [], freeFrom: 9 * 60, freeTo: 19 * 60 },
      { dentistId: 'd2', dentistName: 'Dra. Costa', specialties: [], freeFrom: 9 * 60, freeTo: 19 * 60 },
    ],
  });
  const c = candidate({
    prefs: { preferredDentistId: 'd2', preferredDays: null, preferredTimeStart: null, preferredTimeEnd: null },
  });
  assert.equal(candidateFits(c, two, TODAY).dentist?.dentistId, 'd2');
});

// ─── Aviso mínimo ──────────────────────────────────────────────────────────

test('effectiveOpeningStart leaves a future day untouched', () => {
  const o = { date: '2026-09-10', startMinutes: 9 * 60, endMinutes: 18 * 60 };
  assert.equal(effectiveOpeningStart(o, TODAY, 15 * 60), 9 * 60);
});

// O defeito que esta função existe para corrigir: às 15h a página propunha
// encaixes às 09:00 de hoje.
test('effectiveOpeningStart pushes today past now plus the minimum notice', () => {
  const o = { date: TODAY, startMinutes: 9 * 60, endMinutes: 18 * 60 };
  assert.equal(effectiveOpeningStart(o, TODAY, 15 * 60), 17 * 60);
});

test('effectiveOpeningStart drops what is left of today when it is too short', () => {
  const o = { date: TODAY, startMinutes: 9 * 60, endMinutes: 18 * 60 };
  assert.equal(effectiveOpeningStart(o, TODAY, 16 * 60 + 30), null);
});

test('effectiveOpeningStart drops a day already gone', () => {
  assert.equal(effectiveOpeningStart({ date: '2026-09-01', startMinutes: 540, endMinutes: 1080 }, TODAY, 600), null);
});

// ─── Antecipação ───────────────────────────────────────────────────────────

test('an advance candidate is only offered a slot earlier than the one they already hold', () => {
  const c = candidate({
    source: 'advance',
    currentAppointmentId: 'a1',
    currentAppointmentDate: '2026-09-25',
    busyDates: ['2026-09-25'],
  });
  assert.equal(candidateFits(c, opening({ date: '2026-09-10' }), TODAY).ok, true);
  assert.equal(candidateFits(c, opening({ date: '2026-09-30' }), TODAY).ok, false);
});

test('an advance candidate with nothing booked is not an advance at all', () => {
  const c = candidate({ source: 'advance', currentAppointmentDate: null });
  assert.equal(candidateFits(c, opening(), TODAY).ok, false);
});

// ─── Pontuação ─────────────────────────────────────────────────────────────

function scoreOf(c: DemandCandidate, o: OpeningSlot = opening()) {
  return scoreCandidate(c, o, candidateFits(c, o, TODAY)).score;
}

test('an explicit waitlist opt-in outranks a cold reactivation, all else equal', () => {
  assert.ok(scoreOf(candidate({ source: 'waitlist' })) > scoreOf(candidate({ source: 'reactivation' })));
});

test('being more overdue raises the score', () => {
  assert.ok(scoreOf(candidate({ source: 'recall_due', overdueDays: 45 })) > scoreOf(candidate({ source: 'recall_due' })));
});

test('a patient who often misses appointments scores lower than a reliable one', () => {
  assert.ok(scoreOf(candidate({ noShowRisk: 0.9 })) < scoreOf(candidate({ noShowRisk: 0 })));
});

test('value counts but is capped, so a big plan cannot outweigh everything else', () => {
  const rich = scoreOf(candidate({ source: 'reactivation', valueEur: 5000 }));
  const modest = scoreOf(candidate({ source: 'waitlist', valueEur: 40 }));
  assert.ok(modest > rich);
});

test('the score carries the reasons that produced it', () => {
  const c = candidate({ source: 'recall_due', overdueDays: 30, valueEur: 60 });
  const s = scoreCandidate(c, opening(), candidateFits(c, opening(), TODAY));
  assert.match(s.reasons.join(' · '), /Recall vencido/);
  assert.match(s.reasons.join(' · '), /em atraso há 30 dias/);
});

// ─── Plano ─────────────────────────────────────────────────────────────────

test('planOffers never puts the same patient in two different openings', () => {
  const one = candidate({ sourceId: 'w1' });
  const plans = planOffers([opening({ key: 'o1' }), opening({ key: 'o2', date: '2026-09-07' })], [one], TODAY);
  const appearances = plans.flatMap((p) => p.offers).filter((o) => o.candidate.key === one.key);
  assert.equal(appearances.length, 1);
});

test('planOffers caps how many people are offered the same chair', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map((id) => candidate({ sourceId: id, patientId: id }));
  const [plan] = planOffers([opening()], many, TODAY, { maxPerSlot: 3 });
  assert.equal(plan.offers.length, 3);
});

test('planOffers drops candidates below the minimum score', () => {
  const weak = candidate({ source: 'reactivation', noShowRisk: 1, valueEur: 0 });
  assert.equal(planOffers([opening()], [weak], TODAY, { minScore: 90 }).length, 0);
  assert.equal(planOffers([opening()], [weak], TODAY, { minScore: 0 }).length, 1);
});

test('planOffers fills dead gaps between appointments before the ends of the day', () => {
  const plans = planOffers(
    [opening({ key: 'edge', kind: 'edge', date: '2026-09-04' }), opening({ key: 'gap', kind: 'gap', date: '2026-09-09' })],
    [candidate()],
    TODAY,
  );
  assert.equal(plans[0].opening.key, 'gap');
});

test('planOffers is stable — the same agenda produces the same plan twice', () => {
  const pool = ['a', 'b', 'c'].map((id) => candidate({ sourceId: id, patientId: id }));
  const first = planOffers([opening()], pool, TODAY, { maxPerSlot: 2 });
  const second = planOffers([opening()], [...pool].reverse(), TODAY, { maxPerSlot: 2 });
  assert.deepEqual(
    first[0].offers.map((o) => o.candidate.key),
    second[0].offers.map((o) => o.candidate.key),
  );
});

// ─── Travões da política ───────────────────────────────────────────────────

const NOW = new Date('2026-09-03T10:00:00Z');
const ALL_SOURCES = ['waitlist', 'treatment_open', 'recall_due', 'advance', 'reactivation'];

function limitsOn(candidates: DemandCandidate[], opts: Partial<Parameters<typeof applyContactLimits>[1]> = {}) {
  const plans = planOffers([opening()], candidates, TODAY, { maxPerSlot: 10 });
  return applyContactLimits(plans, {
    now: NOW,
    cooldownDays: 7,
    remainingToday: 100,
    allowedSources: ALL_SOURCES,
    ...opts,
  });
}

test('applyContactLimits never contacts a patient who opted out of SMS', () => {
  const { toContact, withheld } = limitsOn([candidate({ canSms: false })]);
  assert.equal(toContact.length, 0);
  assert.match(withheld[0].reason, /recusou contacto/);
});

test('applyContactLimits skips a patient with no mobile number', () => {
  const { withheld } = limitsOn([candidate({ phone: null })]);
  assert.match(withheld[0].reason, /sem telemóvel/);
});

test('applyContactLimits honours the per-patient cooldown', () => {
  const recent = candidate({ lastContactedAt: '2026-09-01T09:00:00Z' });
  assert.equal(limitsOn([recent]).toContact.length, 0);
  const old = candidate({ lastContactedAt: '2026-07-01T09:00:00Z' });
  assert.equal(limitsOn([old]).toContact.length, 1);
});

test('applyContactLimits stops at the clinic daily cap', () => {
  const many = ['a', 'b', 'c'].map((id) => candidate({ sourceId: id, patientId: id }));
  const { toContact, withheld } = limitsOn(many, { remainingToday: 2 });
  assert.equal(toContact.flatMap((p) => p.offers).length, 2);
  assert.match(withheld[0].reason, /teto diário/);
});

test('applyContactLimits withholds sources the clinic turned off', () => {
  const { toContact, withheld } = limitsOn([candidate({ source: 'reactivation' })], {
    allowedSources: ['waitlist'],
  });
  assert.equal(toContact.length, 0);
  assert.match(withheld[0].reason, /desligada na política/);
});
