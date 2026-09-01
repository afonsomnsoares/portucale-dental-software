import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findHighDemandWeekdays,
  findUnderutilizedUnits,
  suggestCapacityMoves,
} from '../lib/scheduleIntelCalc.ts';

test('findUnderutilizedUnits: flags a unit well below the group average', () => {
  const chairs = [
    { chair: 1, utilizationPct: 80 },
    { chair: 2, utilizationPct: 85 },
    { chair: 3, utilizationPct: 20 },
  ];
  assert.deepEqual(findUnderutilizedUnits(chairs), [{ chair: 3, utilizationPct: 20 }]);
});

test('findUnderutilizedUnits: nothing flagged when everyone is close to the average', () => {
  const chairs = [
    { chair: 1, utilizationPct: 60 },
    { chair: 2, utilizationPct: 65 },
    { chair: 3, utilizationPct: 58 },
  ];
  assert.deepEqual(findUnderutilizedUnits(chairs), []);
});

test('findUnderutilizedUnits: a single unit has no peer group to compare against', () => {
  assert.deepEqual(findUnderutilizedUnits([{ chair: 1, utilizationPct: 5 }]), []);
});

test('findHighDemandWeekdays: flags days meaningfully busier than average', () => {
  const demand = [
    { weekday: 1, demand: 2 },
    { weekday: 2, demand: 10 },
    { weekday: 3, demand: 3 },
  ];
  assert.deepEqual(findHighDemandWeekdays(demand), [{ weekday: 2, demand: 10 }]);
});

test('findHighDemandWeekdays: flat/zero demand flags nothing', () => {
  assert.deepEqual(findHighDemandWeekdays([{ weekday: 1, demand: 0 }]), []);
});

test('suggestCapacityMoves: combines underutilized units and high-demand weekdays into readable suggestions', () => {
  const byChair = [
    { chair: 1, utilizationPct: 80 },
    { chair: 2, utilizationPct: 10 },
  ];
  const byDentist = [
    { dentistId: 'd1', dentistName: 'Dr. Silva', utilizationPct: 75 },
    { dentistId: 'd2', dentistName: 'Dra. Costa', utilizationPct: 78 },
  ];
  const waitlistDemandByWeekday = [
    { weekday: 1, demand: 1 },
    { weekday: 5, demand: 8 },
  ];
  const suggestions = suggestCapacityMoves(byChair, byDentist, waitlistDemandByWeekday);
  assert.deepEqual(
    suggestions.map((s) => s.kind),
    ['chair', 'waitlist_demand'],
  );
  assert.equal(suggestions[0].subject, 'Cadeira 2');
  assert.equal(suggestions[1].subject, 'Sexta');
});

test('suggestCapacityMoves: no suggestions when everything is balanced', () => {
  const byChair = [
    { chair: 1, utilizationPct: 60 },
    { chair: 2, utilizationPct: 62 },
  ];
  const byDentist = [{ dentistId: 'd1', dentistName: 'Dr. Silva', utilizationPct: 61 }];
  assert.deepEqual(suggestCapacityMoves(byChair, byDentist, []), []);
});
