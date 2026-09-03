import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLANK_FILL,
  DOCUMENT_VARIABLES,
  extractPlaceholders,
  formatPtDate,
  formatPtTime,
  renderTemplate,
  unknownPlaceholders,
} from '../lib/documentsCalc.ts';
import { PT_DOCUMENT_TEMPLATES } from '../lib/presets/documentTemplates.ts';

test('extractPlaceholders: finds each marker once, in order of appearance', () => {
  const body = 'Olá {{paciente_nome}}, a consulta é a {{consulta_data}}. Até já, {{paciente_nome}}.';
  assert.deepEqual(extractPlaceholders(body), ['paciente_nome', 'consulta_data']);
});

test('extractPlaceholders: tolerates spaces inside the braces', () => {
  assert.deepEqual(extractPlaceholders('{{ paciente_nome }}'), ['paciente_nome']);
});

test('extractPlaceholders: no markers -> empty', () => {
  assert.deepEqual(extractPlaceholders('Texto sem marcadores'), []);
});

test('unknownPlaceholders: flags a marker the catalogue cannot fill', () => {
  assert.deepEqual(unknownPlaceholders('{{paciente_nome}} e {{numero_da_sorte}}'), ['numero_da_sorte']);
});

test('unknownPlaceholders: every catalogue key is accepted', () => {
  const all = DOCUMENT_VARIABLES.map((v) => `{{${v.key}}}`).join(' ');
  assert.deepEqual(unknownPlaceholders(all), []);
});

test('renderTemplate: substitutes values and reports nothing missing', () => {
  const result = renderTemplate('Declaro que {{paciente_nome}} esteve presente a {{consulta_data}}.', {
    paciente_nome: 'Ana Silva',
    consulta_data: '01/09/2026',
  });
  assert.equal(result.text, 'Declaro que Ana Silva esteve presente a 01/09/2026.');
  assert.deepEqual(result.missing, []);
});

test('renderTemplate: an empty value becomes a fill-in blank, never the raw marker', () => {
  const result = renderTemplate('Nascido(a) a {{paciente_dob}}.', { paciente_dob: '' });
  assert.equal(result.text, `Nascido(a) a ${BLANK_FILL}.`);
  assert.deepEqual(result.missing, ['paciente_dob']);
  assert.ok(!result.text.includes('{{'));
});

test('renderTemplate: a value that was never provided is also blanked and reported', () => {
  const result = renderTemplate('{{paciente_nome}} — {{paciente_email}}', { paciente_nome: 'Ana' });
  assert.equal(result.text, `Ana — ${BLANK_FILL}`);
  assert.deepEqual(result.missing, ['paciente_email']);
});

test('renderTemplate: the same missing marker is reported once, not per occurrence', () => {
  const result = renderTemplate('{{paciente_email}} / {{paciente_email}}', {});
  assert.deepEqual(result.missing, ['paciente_email']);
});

test('formatPtDate: ISO date -> DD/MM/YYYY', () => {
  assert.equal(formatPtDate('2026-09-01'), '01/09/2026');
  assert.equal(formatPtDate('2026-09-01T10:00:00Z'), '01/09/2026');
});

test('formatPtDate: junk returns empty string, never "Invalid Date"', () => {
  assert.equal(formatPtDate(null), '');
  assert.equal(formatPtDate(''), '');
  assert.equal(formatPtDate('ontem'), '');
});

test('formatPtTime: trims seconds, rejects junk', () => {
  assert.equal(formatPtTime('14:30:00'), '14:30');
  assert.equal(formatPtTime('14:30'), '14:30');
  assert.equal(formatPtTime('25:00'), '');
  assert.equal(formatPtTime(null), '');
});

test('PT presets only reference markers the catalogue knows how to fill', () => {
  for (const t of PT_DOCUMENT_TEMPLATES) {
    assert.deepEqual(unknownPlaceholders(`${t.body} ${t.subject}`), [], `template "${t.name}" has unknown markers`);
  }
});

test('PT presets render with no leftover markers once every variable is supplied', () => {
  const vars = Object.fromEntries(DOCUMENT_VARIABLES.map((v) => [v.key, 'X']));
  for (const t of PT_DOCUMENT_TEMPLATES) {
    const result = renderTemplate(t.body, vars);
    assert.deepEqual(result.missing, [], `template "${t.name}" left fields unfilled`);
    assert.ok(!result.text.includes('{{'), `template "${t.name}" still has raw markers`);
  }
});
