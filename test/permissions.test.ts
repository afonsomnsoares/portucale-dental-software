import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV } from '../lib/constants.ts';
import { OVERRIDABLE_ROLES, PERMISSION_ACTIONS, PLATFORM_ACTIONS, canOverride, defaultAllows } from '../lib/permissions.ts';

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

// ─── Overrides por clínica: o que a UI de permissões pode gravar ─────────────
// Estes existem por causa de um buraco concreto. Retirar 'tenants:manage' dos defaults
// do 'admin' (o teste acima) não chegava: setPermissionOverrides só verificava
// `PERMISSION_ACTIONS.includes(action)`, e 'tenants:manage' está nessa lista. Um admin
// tem 'permissions:manage' por omissão, logo podia gravar um override a devolver ao seu
// próprio papel a ação que o default lhe tirava — e hasPermission lê o override ANTES
// do default. Só não era explorável porque as rotas de plataforma verificam o PAPEL
// (requirePlatform), que é o remendo que este teste existe para não voltar a ser
// a única barreira.

test('nenhuma ação de plataforma pode ser concedida por override', () => {
  for (const action of PLATFORM_ACTIONS) {
    for (const role of OVERRIDABLE_ROLES) {
      assert.equal(
        canOverride(role, action),
        false,
        `${role} conseguiria conceder-se '${action}' pela UI de permissões`,
      );
    }
  }
});

test('as ações normais continuam configuráveis por clínica', () => {
  assert.equal(canOverride('receptionist', 'treatments:create'), true);
  assert.equal(canOverride('dentist', 'invoices:read'), true);
  assert.equal(canOverride('admin', 'audit:read'), true);
});

test('o papel do override tem de ser um dos configuráveis', () => {
  // super_admin não tem clínica e hasPermission salta-lhe o override — uma linha com
  // este papel seria estado que nada lê.
  assert.equal(canOverride('super_admin', 'patients:create'), false);
  assert.equal(canOverride('', 'patients:create'), false);
  assert.equal(canOverride('inventado', 'patients:create'), false);
});

test('uma ação que não existe nunca é gravável', () => {
  assert.equal(canOverride('admin', 'nao:existe'), false);
  assert.equal(canOverride('admin', ''), false);
  // Propriedades do protótipo não são ações (PERMISSION_ACTIONS é um array, mas a
  // regressão é barata de fixar).
  assert.equal(canOverride('admin', 'constructor'), false);
  assert.equal(canOverride('admin', '__proto__'), false);
});

test('a matriz mostra exatamente o que pode ser gravado', () => {
  // Se a UI oferecer uma ação que canOverride recusa, o utilizador vê um interruptor
  // que não liga nada.
  const doMenu = PERMISSION_ACTIONS.filter((a) => !PLATFORM_ACTIONS.includes(a));
  for (const action of doMenu) {
    assert.equal(canOverride('admin', action), true, `a matriz oferece '${action}' mas o guardião recusa-o`);
  }
});
