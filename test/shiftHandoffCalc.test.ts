import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHandoffItems,
  currentOrLastBlock,
  type HandoffSignals,
  isNearShiftEnd,
  shiftLabelForBlock,
} from '../lib/shiftHandoffCalc.ts';
import type { ScheduleBlock } from '../lib/staffAvailabilityCalc.ts';

// 2026-08-31 é uma segunda-feira (weekday 1), mesma âncora de staffAvailabilityCalc.test.ts.
const MORNING: ScheduleBlock = { weekday: 1, startTime: '08:00', endTime: '14:00' };
const AFTERNOON: ScheduleBlock = { weekday: 1, startTime: '14:00', endTime: '20:00' };
const at = (h: number, m = 0) => new Date(2026, 7, 31, h, m, 0);

test('shiftLabelForBlock: classifies by start time, not by when it is read', () => {
  assert.equal(shiftLabelForBlock(MORNING), 'morning');
  assert.equal(shiftLabelForBlock(AFTERNOON), 'afternoon');
  assert.equal(shiftLabelForBlock({ weekday: 1, startTime: '19:00', endTime: '23:00' }), 'evening');
});

test('shiftLabelForBlock: no block -> other', () => {
  assert.equal(shiftLabelForBlock(null), 'other');
  assert.equal(shiftLabelForBlock(undefined), 'other');
});

test('currentOrLastBlock: inside a block returns that block', () => {
  assert.equal(currentOrLastBlock([MORNING, AFTERNOON], at(10)), MORNING);
  assert.equal(currentOrLastBlock([MORNING, AFTERNOON], at(16)), AFTERNOON);
});

test('currentOrLastBlock: after every block returns the one that ended most recently', () => {
  assert.equal(currentOrLastBlock([MORNING, AFTERNOON], at(21)), AFTERNOON);
});

test('currentOrLastBlock: exactly at a handover boundary picks the block starting, not the one ending', () => {
  // 14:00 is MORNING's exclusive end and AFTERNOON's inclusive start.
  assert.equal(currentOrLastBlock([MORNING, AFTERNOON], at(14)), AFTERNOON);
});

test('currentOrLastBlock: before the first block of the day -> the day has not started, null', () => {
  assert.equal(currentOrLastBlock([MORNING], at(6)), null);
});

test('currentOrLastBlock: no blocks on this weekday -> null', () => {
  const tuesday = new Date(2026, 8, 1, 10, 0, 0);
  assert.equal(currentOrLastBlock([MORNING], tuesday), null);
});

test('isNearShiftEnd: true inside the window before the shift ends', () => {
  assert.equal(isNearShiftEnd([MORNING], at(13, 15), 60), true);
});

test('isNearShiftEnd: true inside the window after the shift ended — people write it late', () => {
  assert.equal(isNearShiftEnd([MORNING], at(14, 45), 60), true);
});

test('isNearShiftEnd: false in the middle of the shift', () => {
  assert.equal(isNearShiftEnd([MORNING], at(10), 60), false);
});

test('isNearShiftEnd: false long after the shift ended', () => {
  assert.equal(isNearShiftEnd([MORNING], at(17), 60), false);
});

test('isNearShiftEnd: a split shift is near-end around each half', () => {
  assert.equal(isNearShiftEnd([MORNING, AFTERNOON], at(13, 30), 60), true);
  assert.equal(isNearShiftEnd([MORNING, AFTERNOON], at(19, 30), 60), true);
  assert.equal(isNearShiftEnd([MORNING, AFTERNOON], at(16), 60), false);
});

const EMPTY: HandoffSignals = {
  openTasks: [],
  openIncidents: [],
  unfinishedChecklists: [],
  patientsInClinic: [],
  pendingWaitlistOffers: 0,
};

test('buildHandoffItems: nothing pending -> no lines', () => {
  assert.deepEqual(buildHandoffItems(EMPTY), []);
});

test('buildHandoffItems: patients still in the clinic come first — they are the urgent handover', () => {
  const items = buildHandoffItems({
    ...EMPTY,
    patientsInClinic: [{ name: 'Ana Silva', status: 'in-operatory' }],
    openTasks: [{ title: 'Ligar ao doente' }],
  });
  assert.equal(items[0], 'Doente na clínica: Ana Silva (em gabinete)');
  assert.equal(items[1], 'Tarefa aberta: Ligar ao doente');
});

test('buildHandoffItems: an overdue task is marked as such', () => {
  const items = buildHandoffItems({
    ...EMPTY,
    openTasks: [{ title: 'Pedir documento', patientName: 'Rui Costa', overdue: true }],
  });
  assert.equal(items[0], 'Tarefa ATRASADA: Pedir documento — Rui Costa');
});

test('buildHandoffItems: an unknown patient status is shown raw rather than dropped', () => {
  const items = buildHandoffItems({ ...EMPTY, patientsInClinic: [{ name: 'Ana', status: 'novo-estado' }] });
  assert.equal(items[0], 'Doente na clínica: Ana (novo-estado)');
});

test('buildHandoffItems: incidents, checklists and waitlist offers each produce a line', () => {
  const items = buildHandoffItems({
    ...EMPTY,
    openIncidents: [{ title: 'Autoclave em falha', severity: 'critical' }],
    unfinishedChecklists: [{ name: 'Fecho da tarde' }],
    pendingWaitlistOffers: 2,
  });
  assert.deepEqual(items, [
    'Incidente critical por resolver: Autoclave em falha',
    'Checklist por concluir: Fecho da tarde',
    '2 oferta(s) de vaga à espera de resposta',
  ]);
});

test('buildHandoffItems: zero pending offers produces no line at all', () => {
  assert.deepEqual(buildHandoffItems({ ...EMPTY, pendingWaitlistOffers: 0 }), []);
});
