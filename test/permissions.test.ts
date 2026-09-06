import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV } from '../lib/constants.ts';
import { PERMISSION_ACTIONS, PLATFORM_ACTIONS, defaultAllows } from '../lib/permissions.ts';

test('permission actions list is stable', () => {
  assert.ok(Array.isArray(PERMISSION_ACTIONS));
  assert.ok(PERMISSION_ACTIONS.includes('patients:create'));
  assert.ok(PERMISSION_ACTIONS.includes('appointments:update'));
});

test('default permission mapping allows expected actions', () => {
  assert.equal(defaultAllows('receptionist', 'patients:create'), true);
  assert.equal(defaultAllows('receptionist', 'treatments:create'), false);
  assert.equal(defaultAllows('dentist', 'treatments:create'), true);
  assert.equal(defaultAllows('dentist', 'reports:read'), true);
});

// ─── Cruzamento papéis × ações × navegação ───────────────────────────────────
// Estes testes existem por causa de uma regressão concreta: 'admin' e 'super_admin'
// tinham conjuntos de ações IDÊNTICOS (`new Set(PERMISSION_ACTIONS)` os dois), o que
// deixava o admin de clínica com 'tenants:manage'. Só não era explorável porque
// app/api/tenants/route.ts repetia um requireRoles por cima — um remendo numa rota, que
// qualquer rota nova a confiar apenas em hasPermission voltaria a abrir.

test('super_admin e admin não podem ter o mesmo conjunto de ações', () => {
  const superSet = PERMISSION_ACTIONS.filter((a) => defaultAllows('super_admin', a));
  const adminSet = PERMISSION_ACTIONS.filter((a) => defaultAllows('admin', a));
  assert.notDeepEqual(adminSet, superSet, 'admin e super_admin voltaram a ser indistinguíveis');
});

test('as ações de plataforma são exclusivas do super_admin', () => {
  for (const action of PLATFORM_ACTIONS) {
    assert.equal(defaultAllows('super_admin', action), true, `super_admin devia ter ${action}`);
    for (const role of ['admin', 'receptionist', 'dentist']) {
      assert.equal(defaultAllows(role, action), false, `${role} não devia ter ${action}`);
    }
  }
});

test('toda a ação declarada numa entrada de menu existe', () => {
  for (const [role, items] of Object.entries(NAV)) {
    for (const item of items) {
      if (!item.requires) continue;
      assert.ok(
        PERMISSION_ACTIONS.includes(item.requires),
        `${role} → "${item.label}" exige '${item.requires}', que não está em PERMISSION_ACTIONS`,
      );
    }
  }
});

test('nenhum papel tem no menu uma entrada que não pode abrir', () => {
  // O caso que isto apanha já aconteceu duas vezes: a rececionista via 'Tratamentos' sem
  // ter nenhuma ação de tratamentos, e o dentista via 'Agenda Inteligente' sem
  // 'schedule:read'. Ambos davam 403 ao clicar.
  for (const [role, items] of Object.entries(NAV)) {
    for (const item of items) {
      if (!item.requires) continue;
      assert.equal(
        defaultAllows(role, item.requires),
        true,
        `${role} vê "${item.label}" mas não tem '${item.requires}' — link morto`,
      );
    }
  }
});

test('as duas correções de links mortos mantêm-se', () => {
  assert.equal(defaultAllows('receptionist', 'treatments:read'), true);
  assert.equal(defaultAllows('dentist', 'schedule:read'), true);
  // Ler não passa a deixar escrever.
  assert.equal(defaultAllows('receptionist', 'treatments:create'), false);
});
