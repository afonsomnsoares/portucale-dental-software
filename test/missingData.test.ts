import assert from 'node:assert/strict';
import test from 'node:test';
import { findMissingFields } from '../lib/missingData.ts';

function patient(overrides: Partial<Parameters<typeof findMissingFields>[0]> = {}) {
  return {
    phone: '912345678',
    email: 'x@example.com',
    dob: '1990-01-01',
    custom_fields: {},
    ...overrides,
  };
}

test('complete patient with no schema fields -> no missing fields', () => {
  assert.deepEqual(findMissingFields(patient()), []);
});

test('flags each missing core field by name', () => {
  const missing = findMissingFields(patient({ phone: null, email: null }));
  assert.deepEqual(
    missing.map((m) => m.field),
    ['phone', 'email'],
  );
});

test('missing dob is flagged with a PT label', () => {
  const missing = findMissingFields(patient({ dob: null }));
  assert.deepEqual(missing, [{ field: 'dob', label: 'Data de nascimento' }]);
});

test('required custom field absent from custom_fields is flagged', () => {
  const missing = findMissingFields(patient(), [
    { field_name: 'nif', label: 'NIF', required: true, rollout: 100 },
  ]);
  assert.deepEqual(missing, [{ field: 'nif', label: 'NIF' }]);
});

test('required custom field present is not flagged', () => {
  const missing = findMissingFields(patient({ custom_fields: { nif: '123456789' } }), [
    { field_name: 'nif', label: 'NIF', required: true, rollout: 100 },
  ]);
  assert.deepEqual(missing, []);
});

test('required field still rolling out (rollout < 100) is not enforced', () => {
  const missing = findMissingFields(patient(), [
    { field_name: 'nif', label: 'NIF', required: true, rollout: 50 },
  ]);
  assert.deepEqual(missing, []);
});

test('non-required schema field is never flagged even when absent', () => {
  const missing = findMissingFields(patient(), [
    { field_name: 'notes', label: 'Notas', required: false, rollout: 100 },
  ]);
  assert.deepEqual(missing, []);
});

test('empty string custom field value counts as missing', () => {
  const missing = findMissingFields(patient({ custom_fields: { nif: '' } }), [
    { field_name: 'nif', label: 'NIF', required: true, rollout: 100 },
  ]);
  assert.deepEqual(missing, [{ field: 'nif', label: 'NIF' }]);
});
