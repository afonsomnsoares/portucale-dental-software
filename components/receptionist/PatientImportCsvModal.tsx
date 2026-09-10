import { useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { FormField, GhostBtn, Modal, PrimaryBtn, Sel } from '@/components/ui';
import {
  autoMapCsvHeaders,
  detectDelimiter,
  type ImportMapping,
  type ImportResult,
  parseCsv,
  stripBom,
} from '@/lib/csvImport';

const EMPTY_MAPPING: ImportMapping = { name: '', dob: '', phone: '', email: '', insurance: '', alerts: '' };

// Self-contained: owns all of its own import-flow state (parsed CSV, column mapping,
// busy/error/result) and only calls back to the parent once, on a successful import, so it
// can reload the patients list and schema fields. This is the one modal on this page that
// doesn't need its form state lifted, since nothing outside it depends on the CSV mid-flow.
export default function PatientImportCsvModal({
  api,
  onImported,
  onClose,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: mirrors AuthProvider's own api() return type — callers already treat responses as untyped JSON
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  onImported: () => void;
  onClose: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [delimiter, setDelimiter] = useState(',');
  const [mapping, setMapping] = useState<ImportMapping>(EMPTY_MAPPING);
  const [createExtraFields, setCreateExtraFields] = useState(true);
  const [unmappedAsExtra, setUnmappedAsExtra] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  async function onPickFile(file: File | null | undefined) {
    setErr('');
    setResult(null);
    if (!file) return;
    const text: string = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Failed to read file.'));
      r.readAsText(file);
    }).catch((e) => {
      setErr(e instanceof Error ? e.message : 'Failed to read file.');
      return '';
    });
    if (!text) return;
    const firstLine = stripBom(text).split(/\r?\n/)[0] || '';
    const delim = detectDelimiter(firstLine);
    const rows = parseCsv(text, delim);
    const parsedHeaders = (rows[0] || []).map((h) => String(h || '').trim()).filter(Boolean);
    setCsv(text);
    setDelimiter(delim);
    setHeaders(parsedHeaders);
    setMapping(autoMapCsvHeaders(parsedHeaders));
  }

  async function runImport() {
    setErr('');
    setResult(null);
    if (!csv.trim()) {
      setErr('Upload a CSV file first.');
      return;
    }
    if (!mapping.name) {
      setErr('Map the Name column.');
      return;
    }
    setBusy(true);
    try {
      const res = await api('/patients/import', {
        method: 'POST',
        body: {
          csv,
          delimiter,
          mapping,
          createMissingSchemaFields: createExtraFields,
          importUnmappedAsCustom: unmappedAsExtra,
        },
      });
      setResult(res || null);
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  const columnFields: Array<{ key: keyof ImportMapping; label: string; none: string }> = [
    { key: 'name', label: 'Name column *', none: '— Select —' },
    { key: 'dob', label: 'DOB column', none: '— None —' },
    { key: 'phone', label: 'Phone column', none: '— None —' },
    { key: 'email', label: 'Email column', none: '— None —' },
    { key: 'insurance', label: 'Insurance column', none: '— None —' },
    { key: 'alerts', label: 'Alerts column', none: '— None —' },
  ];

  return (
    <Modal title="Importar doentes (CSV)" onClose={onClose} width={640}>
      {err && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            border: '1px solid var(--urgency-critical-border)',
            color: 'var(--urgency-critical)',
            borderRadius: 'var(--radius-control)',
            padding: '10px 12px',
            fontSize: 12,
            marginBottom: 12,
            fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

      <FormField label="Ficheiro CSV" hint="Export from Excel as CSV (UTF-8). Semicolon-separated CSV is supported.">
        <input type="file" accept=".csv,text/csv" onChange={(e) => onPickFile(e.target.files?.[0])} />
      </FormField>

      {headers.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {columnFields.map(({ key, label, none }) => (
            <FormField key={key} label={label}>
              <Sel value={mapping[key]} onChange={(e) => setMapping((p) => ({ ...p, [key]: e.target.value }))}>
                <option value="">{none}</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Sel>
            </FormField>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={createExtraFields} onChange={(e) => setCreateExtraFields(e.target.checked)} />
          Auto-create extra fields for this clinic
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--text-primary)' }}>
          <input type="checkbox" checked={unmappedAsExtra} onChange={(e) => setUnmappedAsExtra(e.target.checked)} />
          Import unmapped columns as extra fields
        </label>
      </div>

      {result && (
        <div
          style={{
            marginTop: 12,
            background: 'var(--urgency-ok-bg)',
            border: '1px solid var(--urgency-ok-border)',
            color: 'var(--urgency-ok)',
            borderRadius: 'var(--radius-control)',
            padding: '10px 12px',
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          Imported: {result.created} · Skipped: {result.skipped}
          {result.errors?.length ? ` · Errors: ${result.errors.length}` : ''}
        </div>
      )}

      <div className="flex gap-3 mt-3">
        <PrimaryBtn onClick={runImport} disabled={busy || !csv.trim()} style={{ justifyContent: 'center' }}>
          {busy ? 'Importing…' : 'Import'}
        </PrimaryBtn>
        <GhostBtn onClick={onClose}>Fechar</GhostBtn>
      </div>
    </Modal>
  );
}
