import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type Booking,
  buildConsolidateMoves,
  buildEquipmentBlockMoves,
  buildGapFillMoves,
  buildGroupVisitMoves,
  buildPreferenceMismatchMoves,
  buildPullForwardMoves,
  buildUnassignedDentistMoves,
  findOpenings,
  type Opening,
  rankMoves,
  TURNAROUND_MINUTES,
  waitlistFitsOpening,
} from '../lib/scheduleOptimizerCalc.ts';

const DAY = { openMinutes: 9 * 60, closeMinutes: 18 * 60 }; // 09:00–18:00
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function booking(over: Partial<Booking> & { appointmentId: string }): Booking {
  return {
    chair: 1,
    date: '2026-03-02',
    startMinutes: 600,
    durationMinutes: 30,
    dentistId: 'd1',
    patientId: 'p1',
    patientName: 'Ana',
    type: 'Cleaning',
    ...over,
  };
}

// ─── findOpenings ──────────────────────────────────────────────────────────

test('findOpenings: one mid-morning appointment leaves an edge before and after', () => {
  const openings = findOpenings([booking({ appointmentId: 'a', startMinutes: 600, durationMinutes: 60 })], DAY, 30);
  assert.deepEqual(
    openings.map((o) => [hhmm(o.startMinutes), hhmm(o.endMinutes), o.kind]),
    [
      ['09:00', '10:00', 'edge'],
      ['11:00', '18:00', 'edge'],
    ],
  );
});

test('findOpenings: a hole between two appointments is a gap, not an edge', () => {
  const openings = findOpenings(
    [
      booking({ appointmentId: 'a', startMinutes: 540, durationMinutes: 60 }), // 09:00-10:00
      booking({ appointmentId: 'b', startMinutes: 720, durationMinutes: 60 }), // 12:00-13:00
    ],
    DAY,
    30,
  );
  const gap = openings.find((o) => o.kind === 'gap');
  assert.ok(gap);
  assert.deepEqual([hhmm(gap.startMinutes), hhmm(gap.endMinutes), gap.durationMinutes], ['10:00', '12:00', 120]);
});

test('findOpenings: openings shorter than the minimum are dropped', () => {
  const openings = findOpenings(
    [
      booking({ appointmentId: 'a', startMinutes: 540, durationMinutes: 60 }), // 09:00-10:00
      booking({ appointmentId: 'b', startMinutes: 615, durationMinutes: 60 }), // 10:15-11:15
    ],
    DAY,
    30,
  );
  // The 15-minute hole is below the threshold; only the tail edge survives.
  assert.deepEqual(
    openings.map((o) => o.kind),
    ['edge'],
  );
});

test('findOpenings: appointments arriving out of order are handled', () => {
  const openings = findOpenings(
    [
      booking({ appointmentId: 'b', startMinutes: 720, durationMinutes: 60 }),
      booking({ appointmentId: 'a', startMinutes: 540, durationMinutes: 60 }),
    ],
    DAY,
    30,
  );
  assert.ok(openings.some((o) => o.kind === 'gap' && o.startMinutes === 600));
});

test('findOpenings: overlapping bookings are merged instead of producing a negative gap', () => {
  const openings = findOpenings(
    [
      booking({ appointmentId: 'a', startMinutes: 540, durationMinutes: 90 }), // 09:00-10:30
      booking({ appointmentId: 'b', startMinutes: 600, durationMinutes: 60 }), // 10:00-11:00 (overlaps)
    ],
    DAY,
    30,
  );
  assert.ok(openings.every((o) => o.durationMinutes > 0));
  assert.deepEqual(
    openings.map((o) => [hhmm(o.startMinutes), hhmm(o.endMinutes)]),
    [['11:00', '18:00']],
  );
});

test('findOpenings: a day booked wall to wall yields nothing', () => {
  const openings = findOpenings(
    [booking({ appointmentId: 'a', startMinutes: 540, durationMinutes: 540 })], // 09:00-18:00
    DAY,
    30,
  );
  assert.deepEqual(openings, []);
});

test('findOpenings: no bookings at all -> empty (the caller handles the whole-day case)', () => {
  assert.deepEqual(findOpenings([], DAY, 30), []);
});

// ─── waitlistFitsOpening ───────────────────────────────────────────────────

const OPENING: Opening = {
  chair: 1,
  date: '2026-03-02', // Monday
  startMinutes: 600,
  endMinutes: 720,
  durationMinutes: 120,
  kind: 'gap',
};
const CANDIDATE = {
  preferredDays: null,
  preferredTimeStart: null,
  preferredTimeEnd: null,
  minDuration: 30,
  maxWaitUntil: null,
  status: 'active',
};

test('waitlistFitsOpening: a plain active candidate fits any big-enough opening', () => {
  assert.equal(waitlistFitsOpening(CANDIDATE, OPENING, '2026-03-01'), true);
});

test('waitlistFitsOpening: a non-active entry never fits', () => {
  assert.equal(waitlistFitsOpening({ ...CANDIDATE, status: 'offered' }, OPENING, '2026-03-01'), false);
});

test('waitlistFitsOpening: an opening shorter than the needed duration is rejected', () => {
  assert.equal(waitlistFitsOpening({ ...CANDIDATE, minDuration: 180 }, OPENING, '2026-03-01'), false);
});

test('waitlistFitsOpening: openings in the past are rejected', () => {
  assert.equal(waitlistFitsOpening(CANDIDATE, OPENING, '2026-03-03'), false);
});

test('waitlistFitsOpening: past the candidate max wait date is rejected', () => {
  assert.equal(waitlistFitsOpening({ ...CANDIDATE, maxWaitUntil: '2026-03-01' }, OPENING, '2026-03-01'), false);
});

test('waitlistFitsOpening: weekday preference is honoured', () => {
  assert.equal(waitlistFitsOpening({ ...CANDIDATE, preferredDays: [1] }, OPENING, '2026-03-01'), true);
  assert.equal(waitlistFitsOpening({ ...CANDIDATE, preferredDays: [5] }, OPENING, '2026-03-01'), false);
});

test('waitlistFitsOpening: partial overlap with the preferred window is enough if the treatment fits in it', () => {
  // Opening 10:00-12:00, patient prefers 11:00-14:00 -> 60 usable minutes.
  const fits = waitlistFitsOpening(
    { ...CANDIDATE, preferredTimeStart: '11:00', preferredTimeEnd: '14:00', minDuration: 60 },
    OPENING,
    '2026-03-01',
  );
  assert.equal(fits, true);
  // Same overlap, but the treatment needs 90 minutes -> does not fit.
  const tooLong = waitlistFitsOpening(
    { ...CANDIDATE, preferredTimeStart: '11:00', preferredTimeEnd: '14:00', minDuration: 90 },
    OPENING,
    '2026-03-01',
  );
  assert.equal(tooLong, false);
});

test('waitlistFitsOpening: no overlap with the preferred window at all is rejected', () => {
  assert.equal(
    waitlistFitsOpening(
      { ...CANDIDATE, preferredTimeStart: '15:00', preferredTimeEnd: '18:00' },
      OPENING,
      '2026-03-01',
    ),
    false,
  );
});

// ─── move builders ─────────────────────────────────────────────────────────

const RUI = { waitlistEntryId: 'w1', patientName: 'Rui', treatmentType: 'Cleaning', minDuration: 30 };
const always = () => true;

test('buildGapFillMoves: only openings with a matching candidate become moves', () => {
  const openings: Opening[] = [OPENING, { ...OPENING, chair: 2, startMinutes: 780, endMinutes: 840 }];
  const moves = buildGapFillMoves(openings, [RUI], (_c, o) => o.chair === 1, hhmm);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].kind, 'gap_fill');
  // The gain is what the patient actually occupies, not the size of the hole.
  assert.equal(moves[0].gainMinutes, 30);
  assert.match(moves[0].detail, /Rui/);
});

test('buildGapFillMoves: a waitlist entry is allocated to exactly one opening', () => {
  // Two openings, one candidate that fits both — the second must stay empty,
  // otherwise the recoverable total double-counts the same person.
  const openings: Opening[] = [OPENING, { ...OPENING, chair: 2 }];
  const moves = buildGapFillMoves(openings, [RUI], always, hhmm);
  assert.equal(moves.length, 1);
  assert.equal(moves.reduce((n, m) => n + m.gainMinutes, 0), 30);
});

test('buildGapFillMoves: several candidates share one opening until it runs out', () => {
  const four = ['A', 'B', 'C', 'D'].map((n, i) => ({
    waitlistEntryId: `w${i}`,
    patientName: n,
    treatmentType: 'Cleaning',
    minDuration: 45,
  }));
  // A 120-minute opening fits two 45-minute treatments, not four.
  const moves = buildGapFillMoves([OPENING], four, always, hhmm);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].gainMinutes, 90);
  assert.match(moves[0].detail, /A, B/);
  assert.ok(!moves[0].detail.includes('C'));
});

test('buildGapFillMoves: a candidate too long for the opening is skipped, a shorter one still fits', () => {
  const moves = buildGapFillMoves(
    [OPENING], // 120 min
    [
      { waitlistEntryId: 'big', patientName: 'Grande', treatmentType: 'Endodontia', minDuration: 180 },
      RUI,
    ],
    always,
    hhmm,
  );
  assert.equal(moves[0].gainMinutes, 30);
  assert.match(moves[0].detail, /Rui/);
  assert.ok(!moves[0].detail.includes('Grande'));
});

test('buildGapFillMoves: gaps between appointments are filled before end-of-day edges', () => {
  const edge: Opening = { ...OPENING, chair: 2, kind: 'edge' };
  const gap: Opening = { ...OPENING, chair: 3, kind: 'gap' };
  const moves = buildGapFillMoves([edge, gap], [RUI], always, hhmm);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].key, 'gap_fill:2026-03-02:3:600');
});

test('buildGapFillMoves: caps the names listed and says how many more there are', () => {
  const many = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({
    waitlistEntryId: `w${i}`,
    patientName: n,
    treatmentType: 'Cleaning',
    minDuration: 20,
  }));
  const moves = buildGapFillMoves([OPENING], many, always, hhmm);
  assert.match(moves[0].detail, /A, B, C \(\+2\)/);
});

test('buildGapFillMoves: keys are stable and unique per chair-day-time', () => {
  // Two 30-minute openings so each can hold exactly one of the two candidates —
  // one big opening would swallow both (see the sharing test above).
  const small: Opening = { ...OPENING, endMinutes: 630, durationMinutes: 30 };
  const moves = buildGapFillMoves(
    [small, { ...small, chair: 2 }],
    [RUI, { ...RUI, waitlistEntryId: 'w2', patientName: 'Ana' }],
    always,
    hhmm,
  );
  assert.equal(new Set(moves.map((m) => m.key)).size, 2);
  assert.equal(moves[0].key, 'gap_fill:2026-03-02:1:600');
  assert.equal(moves[1].key, 'gap_fill:2026-03-02:2:600');
});

test('buildGapFillMoves: no candidates at all produces nothing', () => {
  assert.deepEqual(buildGapFillMoves([OPENING], [], always, hhmm), []);
});

test('buildUnassignedDentistMoves: only appointments without a dentist are flagged', () => {
  const moves = buildUnassignedDentistMoves(
    [booking({ appointmentId: 'a', dentistId: 'd1' }), booking({ appointmentId: 'b', dentistId: null })],
    () => ({ dentistId: 'd2', dentistName: 'Dra. Silva', utilizationPct: 40 }),
  );
  assert.equal(moves.length, 1);
  assert.equal(moves[0].appointmentId, 'b');
  assert.match(moves[0].detail, /Dra\. Silva/);
  // The chair is already booked, so nothing is recovered — only the booking improves.
  assert.equal(moves[0].gainMinutes, 0);
});

test('buildUnassignedDentistMoves: says so plainly when no dentist is free', () => {
  const moves = buildUnassignedDentistMoves([booking({ appointmentId: 'b', dentistId: null })], () => null);
  assert.match(moves[0].detail, /nenhum dentista livre/i);
});

test('buildEquipmentBlockMoves: flags only appointments the predicate marks as blocking', () => {
  const moves = buildEquipmentBlockMoves(
    [booking({ appointmentId: 'a', chair: 3 }), booking({ appointmentId: 'b', chair: 1 })],
    (b) => (b.chair === 3 ? { tags: ['raio_x'], alternativeChair: 1 } : null),
  );
  assert.equal(moves.length, 1);
  assert.equal(moves[0].appointmentId, 'a');
  assert.match(moves[0].detail, /raio_x/);
  assert.match(moves[0].detail, /cadeira 1/);
});

test('buildPreferenceMismatchMoves: an appointment with no violations produces nothing', () => {
  const moves = buildPreferenceMismatchMoves([booking({ appointmentId: 'a' })], () => []);
  assert.deepEqual(moves, []);
});

test('buildPreferenceMismatchMoves: violations are joined into the detail line', () => {
  const moves = buildPreferenceMismatchMoves([booking({ appointmentId: 'a' })], () => [
    'Sábado não está nos dias preferidos',
    'Não é o dentista preferido',
  ]);
  assert.equal(moves.length, 1);
  assert.match(moves[0].detail, /Sábado.*Não é o dentista preferido/);
  assert.equal(moves[0].gainMinutes, 0);
});

// ─── rankMoves ─────────────────────────────────────────────────────────────

test('rankMoves: biggest capacity gain first, quality-only moves last', () => {
  const moves = rankMoves([
    { kind: 'preference_mismatch', key: 'p', title: '', detail: '', gainMinutes: 0 },
    { kind: 'gap_fill', key: 'g1', title: '', detail: '', gainMinutes: 60 },
    { kind: 'gap_fill', key: 'g2', title: '', detail: '', gainMinutes: 180 },
  ]);
  assert.deepEqual(
    moves.map((m) => m.key),
    ['g2', 'g1', 'p'],
  );
});

test('rankMoves: equal gains fall back to date then key, so the order is stable', () => {
  const input = [
    { kind: 'gap_fill' as const, key: 'b', title: '', detail: '', gainMinutes: 30, date: '2026-03-05' },
    { kind: 'gap_fill' as const, key: 'a', title: '', detail: '', gainMinutes: 30, date: '2026-03-02' },
  ];
  assert.deepEqual(
    rankMoves(input).map((m) => m.key),
    ['a', 'b'],
  );
  assert.deepEqual(
    rankMoves([...input].reverse()).map((m) => m.key),
    ['a', 'b'],
  );
});

test('rankMoves: does not mutate its input', () => {
  const input = [
    { kind: 'gap_fill' as const, key: 'a', title: '', detail: '', gainMinutes: 10 },
    { kind: 'gap_fill' as const, key: 'b', title: '', detail: '', gainMinutes: 90 },
  ];
  rankMoves(input);
  assert.equal(input[0].key, 'a');
});

// ═══ Regras 5-7: raciocínio sobre duas ou mais consultas ════════════════════

test('buildGroupVisitMoves: duas consultas do mesmo doente em dias próximos juntam-se', () => {
  const moves = buildGroupVisitMoves(
    [
      {
        patientId: 'p1',
        patientName: 'Ana',
        appointments: [
          booking({ appointmentId: 'a1', date: '2026-03-02', durationMinutes: 30 }),
          booking({ appointmentId: 'a2', date: '2026-03-05', durationMinutes: 30 }),
        ],
      },
    ],
    7,
    120,
  );
  assert.equal(moves.length, 1);
  assert.equal(moves[0].kind, 'group_visit');
  assert.equal(moves[0].gainMinutes, TURNAROUND_MINUTES);
  assert.deepEqual(moves[0].appointmentIds, ['a1', 'a2']);
  // Ancora-se na consulta mais próxima: antecipar é preferível a adiar.
  assert.equal(moves[0].date, '2026-03-02');
});

test('buildGroupVisitMoves: consultas fora da janela não se juntam', () => {
  const moves = buildGroupVisitMoves(
    [
      {
        patientId: 'p1',
        patientName: 'Ana',
        appointments: [
          booking({ appointmentId: 'a1', date: '2026-03-02' }),
          booking({ appointmentId: 'a2', date: '2026-04-20' }),
        ],
      },
    ],
    7,
    120,
  );
  assert.deepEqual(moves, []);
});

test('buildGroupVisitMoves: uma sessão demasiado longa não se propõe', () => {
  const moves = buildGroupVisitMoves(
    [
      {
        patientId: 'p1',
        patientName: 'Ana',
        appointments: [
          booking({ appointmentId: 'a1', date: '2026-03-02', durationMinutes: 90 }),
          booking({ appointmentId: 'a2', date: '2026-03-03', durationMinutes: 90 }),
        ],
      },
    ],
    7,
    120,
  );
  assert.deepEqual(moves, [], 'três horas na cadeira são elas próprias um motivo para desmarcar');
});

test('buildGroupVisitMoves: dentistas diferentes não se juntam', () => {
  const moves = buildGroupVisitMoves(
    [
      {
        patientId: 'p1',
        patientName: 'Ana',
        appointments: [
          booking({ appointmentId: 'a1', date: '2026-03-02', dentistId: 'd1' }),
          booking({ appointmentId: 'a2', date: '2026-03-03', dentistId: 'd2' }),
        ],
      },
    ],
    7,
    240,
  );
  assert.deepEqual(moves, [], 'seriam duas sessões coladas, e a poupança de rotação desaparecia');
});

test('buildGroupVisitMoves: duas consultas no mesmo dia não são um agrupamento', () => {
  const moves = buildGroupVisitMoves(
    [
      {
        patientId: 'p1',
        patientName: 'Ana',
        appointments: [
          booking({ appointmentId: 'a1', date: '2026-03-02', startMinutes: 600 }),
          booking({ appointmentId: 'a2', date: '2026-03-02', startMinutes: 700 }),
        ],
      },
    ],
    7,
    240,
  );
  assert.deepEqual(moves, [], 'isso é adjacência — regra 7');
});

test('buildGroupVisitMoves: três dias seguidos contam três visitas fundidas', () => {
  const moves = buildGroupVisitMoves(
    [
      {
        patientId: 'p1',
        patientName: 'Ana',
        appointments: [
          booking({ appointmentId: 'a1', date: '2026-03-02', durationMinutes: 30 }),
          booking({ appointmentId: 'a2', date: '2026-03-03', durationMinutes: 30 }),
          booking({ appointmentId: 'a3', date: '2026-03-04', durationMinutes: 30 }),
        ],
      },
    ],
    7,
    120,
  );
  assert.equal(moves.length, 1);
  assert.equal(moves[0].gainMinutes, 2 * TURNAROUND_MINUTES);
  assert.equal(moves[0].appointmentIds?.length, 3);
});

const LATER: Booking = booking({ appointmentId: 'x1', date: '2026-04-10', durationMinutes: 30 });
const EARLIER: Opening = {
  chair: 2,
  date: '2026-03-20',
  startMinutes: 660,
  endMinutes: 720,
  durationMinutes: 60,
  kind: 'gap',
};

test('buildPullForwardMoves: antecipar declara os dias, não minutos de capacidade', () => {
  const moves = buildPullForwardMoves([{ booking: LATER, target: EARLIER }], hhmm);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].kind, 'pull_forward');
  assert.equal(moves[0].gainMinutes, 0, 'antecipar troca um lugar por outro, não cria capacidade');
  assert.equal(moves[0].advanceDays, 21);
});

test('buildPullForwardMoves: antecipações insignificantes não se propõem', () => {
  const moves = buildPullForwardMoves(
    [{ booking: booking({ appointmentId: 'x1', date: '2026-03-22' }), target: EARLIER }],
    hhmm,
    3,
  );
  assert.deepEqual(moves, [], 'mover dois dias é incomodar o doente por nada');
});

test('buildPullForwardMoves: um espaço não é prometido a duas consultas', () => {
  const moves = buildPullForwardMoves(
    [
      { booking: booking({ appointmentId: 'x1', date: '2026-04-10' }), target: EARLIER },
      { booking: booking({ appointmentId: 'x2', date: '2026-04-05' }), target: EARLIER },
    ],
    hhmm,
  );
  assert.equal(moves.length, 1);
  assert.equal(moves[0].appointmentId, 'x1', 'a maior antecipação ganha o espaço');
});

test('buildPullForwardMoves: a mesma consulta não é proposta para dois espaços', () => {
  const moves = buildPullForwardMoves(
    [
      { booking: LATER, target: EARLIER },
      { booking: LATER, target: { ...EARLIER, chair: 3, startMinutes: 800, endMinutes: 860 } },
    ],
    hhmm,
  );
  assert.equal(moves.length, 1);
});

test('buildPullForwardMoves: um espaço mais curto do que a consulta é ignorado', () => {
  const moves = buildPullForwardMoves(
    [{ booking: booking({ appointmentId: 'x1', date: '2026-04-10', durationMinutes: 90 }), target: EARLIER }],
    hhmm,
  );
  assert.deepEqual(moves, []);
});

test('buildConsolidateMoves: um buraco entre duas consultas do mesmo doente encosta-se', () => {
  const moves = buildConsolidateMoves(
    [
      {
        first: booking({ appointmentId: 'c1', startMinutes: 540, durationMinutes: 30 }),
        second: booking({ appointmentId: 'c2', startMinutes: 660, durationMinutes: 30 }),
        relation: 'patient',
      },
    ],
    hhmm,
  );
  assert.equal(moves.length, 1);
  assert.equal(moves[0].kind, 'consolidate');
  assert.equal(moves[0].consolidatedMinutes, 90);
  assert.equal(moves[0].gainMinutes, 0, 'o tempo é mudado de sítio, não criado');
});

test('buildConsolidateMoves: buracos pequenos não valem uma remarcação', () => {
  const moves = buildConsolidateMoves(
    [
      {
        first: booking({ appointmentId: 'c1', startMinutes: 540, durationMinutes: 30 }),
        second: booking({ appointmentId: 'c2', startMinutes: 580, durationMinutes: 30 }),
        relation: 'patient',
      },
    ],
    hhmm,
    20,
  );
  assert.deepEqual(moves, []);
});

test('buildConsolidateMoves: a ordem de chegada do par é indiferente', () => {
  const [primeiro] = buildConsolidateMoves(
    [
      {
        first: booking({ appointmentId: 'c2', startMinutes: 660 }),
        second: booking({ appointmentId: 'c1', startMinutes: 540 }),
        relation: 'patient',
      },
    ],
    hhmm,
  );
  assert.equal(primeiro.appointmentId, 'c2', 'move-se sempre a segunda consulta do dia');
});

test('buildConsolidateMoves: uma consulta só entra numa proposta', () => {
  const a = booking({ appointmentId: 'c1', startMinutes: 540, durationMinutes: 30 });
  const b = booking({ appointmentId: 'c2', startMinutes: 660, durationMinutes: 30 });
  const c = booking({ appointmentId: 'c3', startMinutes: 780, durationMinutes: 30 });
  const moves = buildConsolidateMoves(
    [
      { first: a, second: b, relation: 'patient' },
      { first: b, second: c, relation: 'patient' },
    ],
    hhmm,
  );
  assert.equal(moves.length, 1, 'encadear mudanças no mesmo dia é uma cascata, não uma sugestão');
});

test('buildConsolidateMoves: consultas em dias diferentes não são consolidação', () => {
  const moves = buildConsolidateMoves(
    [
      {
        first: booking({ appointmentId: 'c1', date: '2026-03-02' }),
        second: booking({ appointmentId: 'c2', date: '2026-03-03' }),
        relation: 'household',
      },
    ],
    hhmm,
  );
  assert.deepEqual(moves, []);
});

test('rankMoves: as propostas sem capacidade não ficam todas no fundo por empate', () => {
  const ranked = rankMoves([
    { kind: 'preference_mismatch', key: 'pm', title: '', detail: '', gainMinutes: 0, date: '2026-03-02' },
    { kind: 'pull_forward', key: 'pf', title: '', detail: '', gainMinutes: 0, advanceDays: 21, date: '2026-03-02' },
    { kind: 'gap_fill', key: 'gf', title: '', detail: '', gainMinutes: 60, date: '2026-03-02' },
  ]);
  assert.deepEqual(
    ranked.map((m) => m.key),
    ['gf', 'pf', 'pm'],
  );
});
