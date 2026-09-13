'use client';
import { Mic, MicOff } from 'lucide-react';
import { type ChangeEvent, useEffect, useState } from 'react';
import type { ApiOptions, AuthUser } from '@/app/providers';
import { Badge, Empty, FormField, GhostBtn, Inp, PrimaryBtn, Textarea } from '@/components/ui';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import type { NoteAttachment, TimelineEvent } from '@/lib/types';

interface PatientNotesTabProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  user: AuthUser | null;
  patientId: string;
  notes: TimelineEvent[];
  /** Chamado depois de gravar. Substitui os antigos `setNotes`/`refreshTimeline`:
   *  quem sabe o que ficou gravado é o servidor, não este componente. */
  onChanged: () => void;
}

export default function PatientNotesTab({ api, user, patientId, notes, onChanged }: PatientNotesTabProps) {
  const [noteText, setNoteText] = useState('');
  const [noteTags, setNoteTags] = useState('');
  const [noteLinks, setNoteLinks] = useState('');
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const {
    isSupported,
    isRecording,
    transcript,
    interimText,
    toggle: toggleRecording,
    reset: resetTranscript,
    error: speechError,
  } = useSpeechRecognition('pt-PT');

  useEffect(() => {
    if (isRecording) {
      const sep = transcript && interimText ? ' ' : '';
      setNoteText(transcript + sep + interimText);
    }
  }, [transcript, interimText, isRecording]);

  useEffect(() => {
    if (!isRecording && transcript) {
      setNoteText(transcript);
    }
  }, [isRecording, transcript]);

  useEffect(() => {
    setNoteText('');
    setNoteTags('');
    setNoteLinks('');
    setAttachments([]);
    setUploadErr('');
    setSaved(false);
  }, []);

  async function saveNote() {
    if (!patientId || !noteText.trim()) return;
    setSaving(true);
    try {
      const attachmentLines = (attachments || []).map((a) => `- ${a.url}`).join('\n');
      const header = [
        noteTags.trim() ? `Etiquetas: ${noteTags.trim()}` : '',
        noteLinks.trim() ? `Ligações: ${noteLinks.trim()}` : '',
        attachmentLines ? `Anexos:\n${attachmentLines}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const finalText = header ? `${header}\n\n${noteText}` : noteText;
      await api('/notes', { method: 'POST', body: { patientId, noteText: finalText } });
      setSaved(true);
      setNoteText('');
      setNoteTags('');
      setNoteLinks('');
      setAttachments([]);
      setUploadErr('');
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function uploadAttachment(file: File | null | undefined) {
    if (!file || !patientId) return;
    setUploadErr('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('patientId', patientId);
      const res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!res.ok) {
        const contentType = res.headers.get('content-type') || '';
        let msg = res.statusText;
        if (contentType.includes('application/json')) {
          const data = await res.json().catch(() => null);
          msg = data?.message || data?.error || msg;
        } else {
          const text = await res.text().catch(() => '');
          if (text) msg = text;
        }
        throw new Error(msg || 'Falha no envio');
      }
      const out = await res.json();
      if (out?.url) {
        setAttachments((prev) => [
          { url: out.url, name: out.name || file.name, type: out.type || file.type },
          ...(prev || []),
        ]);
        setNoteLinks((prev) => {
          const url = String(out.url || '').trim();
          if (!url) return prev;
          if (!prev) return url;
          if (prev.includes(url)) return prev;
          return `${prev.trim()} ${url}`.trim();
        });
      }
    } catch (e) {
      setUploadErr(e instanceof Error ? e.message : 'Falha ao enviar o anexo.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid-pair" style={{ gap: 16 }}>
      <div className="card p-5">
        <div className="section-label mb-3">NOTA NOVA</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 12 }}>
          {user?.name || 'Dentist'} · {new Date().toLocaleString()}
        </div>
        <div className="grid-pair" style={{ gap: 12, marginBottom: 12 }}>
          <FormField label="Etiquetas (opcional)">
            <Inp
              value={noteTags}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNoteTags(e.target.value)}
              placeholder="ex: pós-operatório, seguimento"
            />
          </FormField>
          <FormField label="Ligações (opcional)">
            <Inp
              value={noteLinks}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNoteLinks(e.target.value)}
              placeholder="ex: https://…"
            />
          </FormField>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div className="section-label mb-1.5">Anexos (opcional)</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="file"
              onChange={(e) => uploadAttachment(e.target.files?.[0] || null)}
              disabled={uploading}
              className="input"
              style={{ width: 280, padding: '7px 12px', fontSize: 'var(--text-sm)' }}
              accept="image/png,image/jpeg,image/webp,application/pdf"
            />
            {uploading && (
              <span
                style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 'var(--weight-bold)' }}
              >
                A enviar…
              </span>
            )}
          </div>
          {uploadErr && (
            <div
              style={{
                marginTop: 8,
                fontSize: 'var(--text-xs)',
                color: 'var(--urgency-critical)',
                fontWeight: 'var(--weight-bold)',
              }}
            >
              {uploadErr}
            </div>
          )}
          {attachments.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {attachments.map((a, i) => (
                <div
                  key={a.url}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'center',
                    background: 'var(--bg-page)',
                    border: '1px solid var(--bg-sunken)',
                    borderRadius: 'var(--radius-control)',
                    padding: '8px 10px',
                  }}
                >
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--accent)',
                      fontWeight: 'var(--weight-bold)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {a.name || a.url}
                  </a>
                  <button
                    type="button"
                    onClick={() => setAttachments((prev) => (prev || []).filter((_, idx) => idx !== i))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: 'var(--text-lg)',
                      lineHeight: 'var(--leading-none)',
                      padding: '0 6px',
                    }}
                    aria-label="Remover anexo"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            onClick={() => {
              if (isRecording) {
                toggleRecording();
              } else {
                resetTranscript();
                toggleRecording();
              }
            }}
            disabled={!isSupported}
            title={
              !isSupported
                ? 'Reconhecimento de voz não suportado neste navegador. Utilize Chrome ou Edge.'
                : isRecording
                  ? 'Parar ditado'
                  : 'Iniciar ditado por voz'
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 'var(--radius-control)',
              border: 'none',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-bold)',
              cursor: !isSupported ? 'not-allowed' : 'pointer',
              background: isRecording
                ? 'var(--urgency-critical)'
                : speechError
                  ? 'var(--urgency-critical-bg)'
                  : 'var(--bg-page)',
              color: isRecording ? '#FFF' : speechError ? 'var(--urgency-critical)' : 'var(--text-primary)',
              opacity: !isSupported ? 0.5 : 1,
            }}
          >
            {isRecording ? <MicOff size={14} /> : <Mic size={14} />}
            {isRecording ? 'Parar' : 'Dictar'}
          </button>
          {isRecording && (
            <span
              style={{
                fontSize: 'var(--text-2xs)',
                color: 'var(--urgency-critical)',
                fontWeight: 'var(--weight-bold)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--urgency-critical)',
                  display: 'inline-block',
                  animation: 'pulse 1.2s ease-in-out infinite',
                }}
              />
              A gravar…
            </span>
          )}
          {speechError && !isRecording && (
            <span
              style={{
                fontSize: 'var(--text-2xs)',
                color: 'var(--urgency-critical)',
                fontWeight: 'var(--weight-semibold)',
              }}
            >
              {speechError}
            </span>
          )}
          {!isSupported && (
            <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)' }}>
              Utilize Chrome ou Edge para dictar
            </span>
          )}
        </div>
        <Textarea
          value={noteText}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
            if (!isRecording) {
              setNoteText(e.target.value);
              setSaved(false);
            }
          }}
          placeholder={isRecording ? 'A ouvir…' : 'Escreva a sua nota clínica…'}
          style={{
            minHeight: 220,
            fontFamily: '"JetBrains Mono",monospace',
            fontSize: 'var(--text-xs)',
            lineHeight: 'var(--leading-prose)',
          }}
        />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
          <PrimaryBtn onClick={saveNote} disabled={saving || !noteText.trim()} style={{ justifyContent: 'center' }}>
            {saving ? 'A guardar…' : 'Guardar nota'}
          </PrimaryBtn>
          <GhostBtn
            onClick={() => {
              setNoteText('');
              setSaved(false);
            }}
            disabled={!noteText.trim()}
          >
            Limpar
          </GhostBtn>
        </div>
        {saved && (
          <div
            style={{
              marginTop: 12,
              fontSize: 'var(--text-xs)',
              color: 'var(--urgency-ok)',
              fontWeight: 'var(--weight-semibold)',
            }}
          >
            Nota guardada no histórico.
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="section-label mb-4">HISTÓRICO</div>
        {!notes.length ? (
          <Empty message="Sem notas para este doente." />
        ) : (
          notes.map((n, i) => (
            <div key={n.id} style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge bg="var(--cat-purple-bg)" color="var(--cat-purple)" label="NOTA" />
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                  <span
                    style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)', fontWeight: 'var(--weight-semibold)' }}
                  >
                    {n.user_name}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 'var(--text-2xs)',
                    color: 'var(--text-muted)',
                    fontFamily: '"JetBrains Mono",monospace',
                  }}
                >
                  #{n.hash}
                </div>
              </div>
              <pre
                style={{
                  fontSize: 'var(--text-2xs)',
                  color: 'var(--text-secondary)',
                  fontFamily: '"JetBrains Mono",monospace',
                  background: 'var(--bg-page)',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-control)',
                  border: '1px solid var(--border-subtle)',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 260,
                  overflowY: 'auto',
                  lineHeight: 'var(--leading-prose)',
                }}
              >
                {n.event}
              </pre>
              {i < notes.length - 1 && <div style={{ borderBottom: '1px solid var(--bg-page)', marginTop: 20 }} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
