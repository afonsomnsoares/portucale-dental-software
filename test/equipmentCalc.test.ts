import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  daysUntilService,
  isEquipmentAvailable,
  nextServiceDate,
  serviceState,
} from '../lib/equipmentCalc.ts';

const HOJE = new Date('2026-06-01T10:00:00Z');

test('serviceState: sem intervalo definido, não se aplica (um armário não tem revisão)', () => {
  assert.equal(serviceState({ serviceIntervalDays: null, lastServicedAt: '2026-01-01' }, HOJE), 'not_applicable');
  assert.equal(serviceState({ serviceIntervalDays: 0, lastServicedAt: '2026-01-01' }, HOJE), 'not_applicable');
});

test('serviceState: tem intervalo mas nunca foi assistido tem estado próprio', () => {
  // É o caso mais fácil de esquecer: não há data nenhuma a envelhecer no ecrã.
  assert.equal(serviceState({ serviceIntervalDays: 180, lastServicedAt: null }, HOJE), 'never_serviced');
});

test('serviceState: dentro do prazo é ok', () => {
  assert.equal(serviceState({ serviceIntervalDays: 180, lastServicedAt: '2026-05-01' }, HOJE), 'ok');
});

test('serviceState: a menos de 14 dias do prazo avisa', () => {
  // 2026-01-01 + 160 dias = 2026-06-10, faltam 9 dias.
  assert.equal(serviceState({ serviceIntervalDays: 160, lastServicedAt: '2026-01-01' }, HOJE), 'due_soon');
});

test('serviceState: passado o prazo fica vencido', () => {
  assert.equal(serviceState({ serviceIntervalDays: 90, lastServicedAt: '2026-01-01' }, HOJE), 'overdue');
});

test('serviceState: exatamente no dia do vencimento ainda não está vencido', () => {
  // 2026-03-03 + 90 dias = 2026-06-01, que é hoje.
  assert.equal(serviceState({ serviceIntervalDays: 90, lastServicedAt: '2026-03-03' }, HOJE), 'due_soon');
});

test('daysUntilService: negativo quando já passou', () => {
  const dias = daysUntilService({ serviceIntervalDays: 90, lastServicedAt: '2026-01-01' }, HOJE);
  assert.ok(dias !== null && dias < 0, `esperava negativo, veio ${dias}`);
});

test('daysUntilService: null quando não há intervalo ou nunca foi assistido', () => {
  assert.equal(daysUntilService({ serviceIntervalDays: null, lastServicedAt: '2026-01-01' }, HOJE), null);
  assert.equal(daysUntilService({ serviceIntervalDays: 90, lastServicedAt: null }, HOJE), null);
});

test('daysUntilService: data inválida não rebenta', () => {
  assert.equal(daysUntilService({ serviceIntervalDays: 90, lastServicedAt: 'ontem' }, HOJE), null);
});

test('isEquipmentAvailable: só operacional E no catálogo conta', () => {
  assert.equal(isEquipmentAvailable({ active: true, status: 'operational' }), true);
  assert.equal(isEquipmentAvailable({ active: true, status: 'maintenance' }), false);
  assert.equal(isEquipmentAvailable({ active: true, status: 'broken' }), false);
  assert.equal(isEquipmentAvailable({ active: false, status: 'operational' }), false);
});

test('uma revisão vencida não torna o equipamento indisponível por si só', () => {
  // Avisa, mas não cancela agenda de ninguém — quem tira de serviço é uma pessoa.
  const vencido = { serviceIntervalDays: 30, lastServicedAt: '2026-01-01' };
  assert.equal(serviceState(vencido, HOJE), 'overdue');
  assert.equal(isEquipmentAvailable({ active: true, status: 'operational' }), true);
});

test('nextServiceDate: soma o intervalo à última assistência', () => {
  assert.equal(nextServiceDate({ serviceIntervalDays: 90, lastServicedAt: '2026-01-01' }), '2026-04-01');
  assert.equal(nextServiceDate({ serviceIntervalDays: null, lastServicedAt: '2026-01-01' }), null);
  assert.equal(nextServiceDate({ serviceIntervalDays: 90, lastServicedAt: null }), null);
});
