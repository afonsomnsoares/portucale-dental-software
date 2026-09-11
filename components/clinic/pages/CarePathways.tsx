'use client';
// ─── Percursos de consulta ──────────────────────────────────────────────────
// O que tem de acontecer antes e depois de cada tipo de consulta: «implante amanhã →
// gerar consentimento, confirmar dados em falta, pedir jejum pelo portal». O motor
// existia inteiro (lib/carePathway.ts, migração 048) e não havia onde escrever os passos.
//
// ─── Porque é que a pré-visualização está sempre à vista ────────────────────
// Um percurso é uma regra sobre datas relativas — «dois dias antes», «no dia seguinte» —
// e uma lista de offsets não se lê. `previewPathway` transforma isso em datas concretas
// para uma consulta hipotética, e é a única forma de alguém perceber o que acabou de
// configurar sem esperar pela próxima consulta daquele tipo. É por isso que a data de
// simulação está no topo e não escondida atrás de um botão.
//
// A validação é a do servidor, mostrada tal e qual. `validatePathwaySteps` apanha as três
// maneiras de configurar um percurso que nunca dispara nada — todas silenciosas — e
// repetir essas regras aqui seria criar uma segunda verdade que mais tarde diverge.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Empty, Inp, PageHeader, PrimaryBtn, Sel, Spinner } from '@/components/ui';
import { APPOINTMENT_TYPES } from '@/lib/constants';

interface Step {
  id: string;
  position: number;
  phase: 'pre' | 'post';
  action: string;
  title: string;
  offsetDays: number;
  roles: string[];
  blocking: boolean;
}
interface PreviewEntry {
  step: Step;
  date: string;
  relative: string;
}
interface Template {
  id: string;
  appointmentType: string;
  name: string;
  description: string;
  active: boolean;
  steps: Step[];
  preview?: PreviewEntry[];
}
interface Acao {
  value: string;
  label: string;
}

function amanha() {
  return new Date(Date.now() + 86400000).toLocaleDateString('en-CA');
}

const PASSO_NOVO = (n: number): Step => ({
  id: `passo-${n}`,
  position: n,
  phase: 'pre',
  action: 'task',
  title: '',
  offsetDays: -1,
  roles: [],
  blocking: false,
});

export default function CarePathways() {
  const { api } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [acoes, setAcoes] = useState<Acao[]>([]);
  const [dataSimulada, setDataSimulada] = useState(amanha);
  const [aCarregar, setACarregar] = useState(true);
  const [erro, setErro] = useState('');

  // Rascunho de um percurso novo. Um só de cada vez: configurar dois percursos em
  // paralelo não é um problema que alguém tenha.
  const [rascunho, setRascunho] = useState<{ appointmentType: string; name: string; steps: Step[] } | null>(null);
  const [aGravar, setAGravar] = useState(false);

  const carregar = useCallback(async () => {
    setACarregar(true);
    try {
      const r = await api(`/care-pathways?previewDate=${dataSimulada}`);
      setTemplates(r?.templates || []);
      setAcoes(r?.actions || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os percursos.');
    } finally {
      setACarregar(false);
    }
  }, [api, dataSimulada]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const gravar = useCallback(async () => {
    if (!rascunho) return;
    setAGravar(true);
    setErro('');
    try {
      await api('/care-pathways', {
        method: 'POST',
        body: { ...rascunho, steps: rascunho.steps.map((s, i) => ({ ...s, position: i })) },
      });
      setRascunho(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gravar o percurso.');
    } finally {
      setAGravar(false);
    }
  }, [api, rascunho, carregar]);

  const mudarPasso = (i: number, patch: Partial<Step>) => {
    if (!rascunho) return;
    setRascunho({ ...rascunho, steps: rascunho.steps.map((s, j) => (i === j ? { ...s, ...patch } : s)) });
  };

  return (
    <div>
      <PageHeader
        title="Percursos de Consulta"
        sub="O que tem de estar feito antes e depois de cada tipo de consulta. O motor corre sozinho — isto é onde se escreve o protocolo da clínica."
      >
        <Inp
          type="date"
          value={dataSimulada}
          onChange={(e) => setDataSimulada(e.target.value)}
          style={{ width: 165 }}
          aria-label="Data de consulta a simular"
        />
      </PageHeader>

      {erro && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-control)',
            marginBottom: 14,
            fontSize: 13,
            whiteSpace: 'pre-wrap',
          }}
        >
          {erro}
        </div>
      )}

      {/* ── Rascunho ── */}
      {rascunho ? (
        <div
          style={{
            border: '1px solid var(--accent)',
            borderRadius: 'var(--radius-card)',
            background: 'var(--bg-surface)',
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <Sel
              value={rascunho.appointmentType}
              onChange={(e) => setRascunho({ ...rascunho, appointmentType: e.target.value })}
            >
              <option value="">Tipo de consulta…</option>
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t.label} value={t.label}>
                  {t.label}
                </option>
              ))}
            </Sel>
            <Inp
              value={rascunho.name}
              onChange={(e) => setRascunho({ ...rascunho, name: e.target.value })}
              placeholder="Nome do percurso"
            />
          </div>

          {rascunho.steps.map((s, i) => (
            <div
              key={s.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1.6fr 100px 110px 90px auto',
                gap: 8,
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Inp
                value={s.title}
                onChange={(e) => mudarPasso(i, { title: e.target.value })}
                placeholder="O que fazer"
              />
              <Sel value={s.phase} onChange={(e) => mudarPasso(i, { phase: e.target.value as 'pre' | 'post' })}>
                <option value="pre">Antes</option>
                <option value="post">Depois</option>
              </Sel>
              <Sel value={s.action} onChange={(e) => mudarPasso(i, { action: e.target.value })}>
                {acoes.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </Sel>
              <Inp
                type="number"
                value={String(s.offsetDays)}
                onChange={(e) => mudarPasso(i, { offsetDays: Number(e.target.value) })}
                aria-label="Dias relativos à consulta"
              />
              <label style={{ fontSize: 11.5, display: 'flex', gap: 5, alignItems: 'center', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={s.blocking}
                  onChange={(e) => mudarPasso(i, { blocking: e.target.checked })}
                />
                bloqueante
              </label>
            </div>
          ))}

          <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '4px 0 12px' }}>
            Dias negativos são antes da consulta, positivos depois, zero no próprio dia. Um passo bloqueante é um que,
            por não estar feito, torna a consulta problemática — um implante sem consentimento assinado.
          </p>

          <div style={{ display: 'flex', gap: 8 }}>
            <PrimaryBtn onClick={gravar} disabled={aGravar || !rascunho.appointmentType || !rascunho.name.trim()}>
              {aGravar ? 'A gravar…' : 'Gravar percurso'}
            </PrimaryBtn>
            <button
              type="button"
              onClick={() =>
                setRascunho({ ...rascunho, steps: [...rascunho.steps, PASSO_NOVO(rascunho.steps.length)] })
              }
              style={{
                fontSize: 12.5,
                padding: '6px 12px',
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              + Passo
            </button>
            <button
              type="button"
              onClick={() => setRascunho(null)}
              style={{
                fontSize: 12.5,
                padding: '6px 12px',
                borderRadius: 'var(--radius-control)',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 18 }}>
          <PrimaryBtn onClick={() => setRascunho({ appointmentType: '', name: '', steps: [PASSO_NOVO(0)] })}>
            Novo percurso
          </PrimaryBtn>
        </div>
      )}

      {/* ── Percursos configurados ── */}
      {aCarregar ? (
        <Spinner />
      ) : templates.length === 0 ? (
        <Empty message="Nenhum percurso configurado. Sem eles, o motor corre e não encontra nada para fazer — os passos são o protocolo da clínica, e só a clínica os sabe." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {templates.map((t) => (
            <div
              key={t.id}
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-card)',
                background: 'var(--bg-surface)',
                padding: '14px 16px',
                opacity: t.active ? 1 : 0.6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{t.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}> · {t.appointmentType}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {t.steps.length} {t.steps.length === 1 ? 'passo' : 'passos'}
                </span>
              </div>

              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {(t.preview || t.steps.map((step) => ({ step, date: '', relative: '' }))).map((p) => (
                  <div
                    key={p.step.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0,1fr) 120px 110px',
                      gap: 10,
                      fontSize: 12.5,
                      alignItems: 'baseline',
                      paddingLeft: 10,
                      borderLeft: `2px solid ${p.step.blocking ? 'var(--urgency-critical)' : 'var(--border-subtle)'}`,
                    }}
                  >
                    <span>
                      {p.step.title}
                      {p.step.blocking && (
                        <span style={{ fontSize: 10.5, color: 'var(--urgency-critical)' }}> · bloqueante</span>
                      )}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {acoes.find((a) => a.value === p.step.action)?.label || p.step.action}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {p.date ? `${p.date} · ${p.relative}` : p.step.phase === 'pre' ? 'antes' : 'depois'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
