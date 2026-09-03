// Puro — sem imports de DB, testável como lib/checklistCalc.ts. Tudo o que sabe
// transformar um modelo de documento administrativo (item 10 da automação) no
// texto final vive aqui; lib/documents.ts trata só de ir buscar os dados e
// gravar o resultado.

export type DocumentTemplateType = 'declaration' | 'justification' | 'letter' | 'other';

export const DOCUMENT_TEMPLATE_TYPES: readonly DocumentTemplateType[] = [
  'declaration',
  'justification',
  'letter',
  'other',
] as const;

// Catálogo fechado de marcadores. Fechado de propósito: um modelo que refira
// {{qualquer_coisa}} que não esteja aqui nunca vai ser preenchido, e é melhor
// dizê-lo a quem está a escrever o modelo do que descobri-lo com o doente à
// frente. A UI usa `label` para listar o que está disponível.
export const DOCUMENT_VARIABLES: Array<{ key: string; label: string }> = [
  { key: 'paciente_nome', label: 'Nome do paciente' },
  { key: 'paciente_dob', label: 'Data de nascimento do paciente' },
  { key: 'paciente_telefone', label: 'Telefone do paciente' },
  { key: 'paciente_email', label: 'Email do paciente' },
  { key: 'paciente_seguro', label: 'Seguro/subsistema do paciente' },
  { key: 'consulta_data', label: 'Data da consulta' },
  { key: 'consulta_hora', label: 'Hora da consulta' },
  { key: 'consulta_tipo', label: 'Tipo de consulta' },
  { key: 'consulta_duracao', label: 'Duração da consulta (minutos)' },
  { key: 'dentista_nome', label: 'Nome do médico dentista' },
  { key: 'clinica_nome', label: 'Nome da clínica' },
  { key: 'clinica_cidade', label: 'Cidade da clínica' },
  { key: 'emitido_por', label: 'Quem emite o documento' },
  { key: 'data_hoje', label: 'Data de hoje' },
];

const KNOWN_KEYS = new Set(DOCUMENT_VARIABLES.map((v) => v.key));

// Aceita espaços dentro das chavetas ({{ paciente_nome }}) porque é o erro de
// escrita mais provável de quem monta um modelo, e falhar por causa disso não
// ajudaria ninguém.
const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

// O que fica no lugar de um marcador sem valor. Um traço de preenchimento à mão
// é o comportamento certo para um documento que vai ser impresso: nunca se pode
// imprimir "{{paciente_dob}}" numa declaração entregue ao doente.
export const BLANK_FILL = '__________';

export function extractPlaceholders(text: string): string[] {
  const found: string[] = [];
  for (const m of String(text || '').matchAll(PLACEHOLDER_RE)) {
    const key = m[1].toLowerCase();
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

// Marcadores que o modelo usa mas que o catálogo não sabe preencher — avisados
// a quem edita o modelo, não a quem emite o documento.
export function unknownPlaceholders(text: string): string[] {
  return extractPlaceholders(text).filter((k) => !KNOWN_KEYS.has(k));
}

export interface RenderResult {
  text: string;
  // Marcadores conhecidos que ficaram por preencher (valor vazio) — a UI avisa
  // antes de emitir, para o utilizador decidir se preenche à mão em papel.
  missing: string[];
}

export function renderTemplate(text: string, vars: Record<string, string>): RenderResult {
  const missing: string[] = [];
  const out = String(text || '').replace(PLACEHOLDER_RE, (_full, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const value = vars[key];
    if (value === undefined || value === null || value === '') {
      if (!missing.includes(key)) missing.push(key);
      return BLANK_FILL;
    }
    return value;
  });
  return { text: out, missing };
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY'. Devolve '' para entradas vazias/inválidas em vez
// de 'Invalid Date', porque o resultado vai direto para dentro de um documento.
export function formatPtDate(value: unknown): string {
  const s = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

// 'HH:MM:SS' ou 'HH:MM' -> 'HH:MM'.
export function formatPtTime(value: unknown): string {
  const s = String(value || '').slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? s : '';
}
