// Client-side CSV parsing for the "Import Patients (CSV)" flow on the receptionist
// Patients page — the whole file is read into memory and parsed in the browser so the
// column-mapping UI can be built before anything is sent to POST /api/patients/import.

export interface ImportMapping {
  name: string;
  dob: string;
  phone: string;
  email: string;
  insurance: string;
  alerts: string;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors?: string[];
}

export function normalizeKey(s: unknown) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

export function stripBom(s: string) {
  if (!s) return '';
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function detectDelimiter(line: string) {
  const commas = (line.match(/,/g) || []).length;
  const semis = (line.match(/;/g) || []).length;
  return semis > commas ? ';' : ',';
}

export function parseCsv(text: unknown, delimiter: string) {
  const out: string[][] = [];
  const s = stripBom(String(text || ''))
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n');
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = s[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(cur);
      cur = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cur);
      cur = '';
      const isAllEmpty = row.every((v) => String(v || '').trim() === '');
      if (!isAllEmpty) out.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  row.push(cur);
  if (!row.every((v) => String(v || '').trim() === '')) out.push(row);
  return out;
}

export function autoMapCsvHeaders(headers: string[]): ImportMapping {
  const list = (headers || []).map((h) => ({ raw: h, key: normalizeKey(h) }));
  const pick = (syn: string[]) => {
    const synSet = new Set(syn.map(normalizeKey));
    const exact = list.find((h) => synSet.has(h.key));
    if (exact) return exact.raw;
    const contains = list.find((h) => syn.some((s) => h.key.includes(normalizeKey(s))));
    return contains?.raw || '';
  };
  return {
    name: pick(['name', 'nome', 'nome completo', 'paciente', 'patient']),
    dob: pick(['dob', 'data de nascimento', 'nascimento', 'birth date']),
    phone: pick(['phone', 'telefone', 'telemovel', 'telemóvel', 'tlm', 'mobile']),
    email: pick(['email', 'e-mail']),
    insurance: pick(['insurance', 'seguro', 'subsistema', 'adse', 'multicare', 'medis', 'médis']),
    alerts: pick(['alerts', 'alertas', 'alergias', 'alergia', 'allergies']),
  };
}
