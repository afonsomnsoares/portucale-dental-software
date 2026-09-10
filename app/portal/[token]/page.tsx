'use client';

import { type FormEvent, use, useEffect, useState } from 'react';

// Public, unauthenticated page (no dashboard chrome, no AuthProvider dependency beyond
// the root layout wrapper) backing the patient-portal API
// (app/api/public/patient-portal/[token]/route.ts) — item 4's "enviar/recolher
// formulários", "pedir documentos". Reached only via a link staff generate from
// POST /api/patient-portal-links, never guessable/browsable.

interface MissingField {
  field: string;
  label: string;
}
interface SchemaFieldMeta {
  fieldName: string;
  label: string;
  fieldType: string;
  enumValues: unknown;
}
interface PortalData {
  purpose: 'missing_data' | 'document_upload' | 'consent_form';
  patientName: string;
  tenantName: string;
  missingFields?: MissingField[];
  fields?: SchemaFieldMeta[];
  task?: { title: string; notes: string } | null;
  consentForm?: { procedure_name: string; description: string } | null;
}

const INPUT =
  'w-full rounded-lg border border-[var(--entry-line)] bg-white py-2.5 px-3.5 text-[15px] text-[var(--entry-text)] placeholder:text-[var(--entry-placeholder)] transition-colors focus:border-[var(--entry-accent)] focus:outline-none focus:ring-4 focus:ring-[var(--entry-focus-ring)] disabled:opacity-60';
const LABEL = 'mb-1.5 block text-[13px] font-medium text-[var(--entry-slate)]';
const BTN =
  'flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--entry-ink)] px-4 py-3 text-[15px] font-medium text-white transition-colors hover:bg-[var(--entry-ink-hover)] disabled:cursor-not-allowed disabled:opacity-70';

function friendlyError(status: number, message: string) {
  if (status === 401) return 'Este link não é válido.';
  if (status === 410)
    return message === 'This link was already used' ? 'Este link já foi utilizado.' : 'Este link expirou.';
  if (status === 429) return 'Demasiados pedidos. Aguarde um momento e tente outra vez.';
  return message || 'Não foi possível concluir o pedido. Tente outra vez.';
}

export default function PatientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<PortalData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/public/patient-portal/${encodeURIComponent(token)}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(friendlyError(res.status, body.error));
        } else {
          setData(body);
        }
      } catch {
        if (!cancelled) setLoadError('Não foi possível contactar o servidor.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--entry-canvas)] px-6 py-12">
      <div className="w-full max-w-[28rem] rounded-xl border border-[var(--entry-line)] bg-white p-8 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--entry-accent)]">
          {data?.tenantName || 'Portucale Dental'}
        </p>
        {loading && <p className="mt-4 text-[15px] text-[var(--entry-text-muted)]">A carregar…</p>}
        {loadError && !loading && (
          <p className="mt-4 rounded-md border border-[var(--entry-alert-border)] bg-[var(--entry-alert-bg)] px-3.5 py-3 text-[14px] text-[var(--entry-alert)]">
            {loadError}
          </p>
        )}
        {submitted && (
          <>
            <h1 className="mt-3 text-[1.5rem] leading-[1.15] text-[var(--entry-text)]">Obrigado!</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-[var(--entry-text-muted)]">
              A sua informação foi enviada para a clínica. Já não precisa de fazer mais nada — a equipa trata do resto.
            </p>
          </>
        )}
        {data && !submitted && !loading && <PortalForm token={token} data={data} onDone={() => setSubmitted(true)} />}
      </div>
    </div>
  );
}

function PortalForm({ token, data, onDone }: { token: string; data: PortalData; onDone: () => void }) {
  if (data.purpose === 'missing_data') return <MissingDataForm token={token} data={data} onDone={onDone} />;
  if (data.purpose === 'document_upload') return <DocumentUploadForm token={token} data={data} onDone={onDone} />;
  return <ConsentForm token={token} data={data} onDone={onDone} />;
}

function useSubmitState() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return { busy, setBusy, error, setError };
}

async function postJson(token: string, body: unknown) {
  const res = await fetch(`/api/public/patient-portal/${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(res.status, json.error));
  return json;
}

function MissingDataForm({ token, data, onDone }: { token: string; data: PortalData; onDone: () => void }) {
  const { busy, setBusy, error, setError } = useSubmitState();
  const [values, setValues] = useState<Record<string, string>>({});
  const missing = data.missingFields || [];
  const customFieldMeta = new Map((data.fields || []).map((f) => [f.fieldName, f]));

  if (!missing.length) {
    return (
      <p className="mt-4 text-[15px] leading-relaxed text-[var(--entry-text-muted)]">
        Olá {data.patientName}, não temos nada em falta neste momento. Obrigado!
      </p>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const core: Record<string, string> = {};
      const customFields: Record<string, string> = {};
      for (const f of missing) {
        const v = (values[f.field] || '').trim();
        if (['phone', 'email', 'dob'].includes(f.field)) core[f.field] = v;
        else customFields[f.field] = v;
      }
      await postJson(token, { ...core, customFields });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <h1 className="text-[1.4rem] leading-[1.2] text-[var(--entry-text)]">Olá {data.patientName}</h1>
      <p className="text-[14px] leading-relaxed text-[var(--entry-text-muted)]">
        Faltam-nos alguns dados para a sua ficha em {data.tenantName}.
      </p>
      {error && (
        <p className="rounded-md border border-[var(--entry-alert-border)] bg-[var(--entry-alert-bg)] px-3 py-2 text-[13px] text-[var(--entry-alert)]">
          {error}
        </p>
      )}
      {missing.map((f) => {
        const meta = customFieldMeta.get(f.field);
        return (
          <div key={f.field}>
            <label className={LABEL} htmlFor={f.field}>
              {f.label}
            </label>
            <input
              id={f.field}
              className={INPUT}
              type={f.field === 'email' ? 'email' : f.field === 'dob' ? 'date' : 'text'}
              value={values[f.field] || ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.field]: e.target.value }))}
              required
              disabled={busy}
              placeholder={meta?.label || f.label}
            />
          </div>
        );
      })}
      <button type="submit" disabled={busy} className={BTN}>
        {busy ? 'A enviar…' : 'Enviar'}
      </button>
    </form>
  );
}

function DocumentUploadForm({ token, data, onDone }: { token: string; data: PortalData; onDone: () => void }) {
  const { busy, setBusy, error, setError } = useSubmitState();
  const [file, setFile] = useState<File | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/public/patient-portal/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(friendlyError(res.status, json.error));
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <h1 className="text-[1.4rem] leading-[1.2] text-[var(--entry-text)]">Olá {data.patientName}</h1>
      <p className="text-[14px] leading-relaxed text-[var(--entry-text-muted)]">
        {data.task?.title || `A equipa de ${data.tenantName} pediu-lhe um documento.`}
      </p>
      {data.task?.notes && <p className="text-[13px] text-[var(--entry-text-subtle)]">{data.task.notes}</p>}
      {error && (
        <p className="rounded-md border border-[var(--entry-alert-border)] bg-[var(--entry-alert-bg)] px-3 py-2 text-[13px] text-[var(--entry-alert)]">
          {error}
        </p>
      )}
      <div>
        <label className={LABEL} htmlFor="file">
          Ficheiro (PDF, PNG, JPG ou WEBP, até 6MB)
        </label>
        <input
          id="file"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          disabled={busy}
          required
          className="block w-full text-[14px] text-[var(--entry-slate)]"
        />
      </div>
      <button type="submit" disabled={busy || !file} className={BTN}>
        {busy ? 'A enviar…' : 'Enviar documento'}
      </button>
    </form>
  );
}

function ConsentForm({ token, data, onDone }: { token: string; data: PortalData; onDone: () => void }) {
  const { busy, setBusy, error, setError } = useSubmitState();
  const [signedBy, setSignedBy] = useState('');
  const [agreed, setAgreed] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await postJson(token, { signedBy: signedBy.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao enviar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-4">
      <h1 className="text-[1.4rem] leading-[1.2] text-[var(--entry-text)]">Olá {data.patientName}</h1>
      <p className="text-[14px] font-medium text-[var(--entry-text)]">{data.consentForm?.procedure_name}</p>
      {data.consentForm?.description && (
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--entry-text-muted)]">
          {data.consentForm.description}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-[var(--entry-alert-border)] bg-[var(--entry-alert-bg)] px-3 py-2 text-[13px] text-[var(--entry-alert)]">
          {error}
        </p>
      )}
      <label className="flex items-start gap-2 text-[13px] text-[var(--entry-slate)]">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          disabled={busy}
          className="mt-0.5"
        />
        Li e concordo com o procedimento descrito acima.
      </label>
      <div>
        <label className={LABEL} htmlFor="signedBy">
          Escreva o seu nome completo para assinar
        </label>
        <input
          id="signedBy"
          className={INPUT}
          value={signedBy}
          onChange={(e) => setSignedBy(e.target.value)}
          disabled={busy}
          required
        />
      </div>
      <button type="submit" disabled={busy || !agreed || !signedBy.trim()} className={BTN}>
        {busy ? 'A assinar…' : 'Assinar'}
      </button>
    </form>
  );
}
