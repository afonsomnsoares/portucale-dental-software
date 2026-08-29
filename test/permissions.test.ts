import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSION_ACTIONS, defaultAllows } from '../lib/permissions.ts';

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
