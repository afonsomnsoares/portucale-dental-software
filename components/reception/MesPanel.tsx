'use client';
import { useMemo, useState } from 'react';
import { useAuth } from '@/app/providers';
import { ErrorState, GhostBtn, over, Spinner, tint, WorkSection } from '@/components/ui';
import { useQuery } from '@/hooks/useQuery';
import type { Appointment } from '@/lib/types';

// ─── O mês ──────────────────────────────────────────────────────────────────
// A agenda tinha o DIA (a grelha de horas do painel) e a LISTA (marcadas, com
// intervalo de datas). Faltava o meio-termo: o mês é onde se vê a FORMA das
// semanas — que terça está cheia, que sexta está vazia, onde estão os feriados —
// antes de se olhar para uma hora concreta.
//
// Não é um destino novo: é um separador da Agenda, sobre os mesmos dados e os
// mesmos filtros. Carregar num dia leva à lista já filtrada por esse dia, que é
// o que faz das duas vistas um ecrã e não dois.

const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const MAX_POR_CELULA = 4;

/**
 * Número de semana ISO 8601 — o que Portugal usa e o que uma equipa diz ao
 * telefone («foi na 38»).
 *
 * A regra é a da quinta-feira: a semana pertence ao ano em que cai a sua
 * quinta-feira. Sem isso, os primeiros dias de janeiro dão «semana 1» quando são
 * a 52 ou a 53 do ano anterior — o erro clássico, e o que faz dois relatórios do
 * mesmo período não bater certo.
 */
function semanaISO(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const diaSemana = t.getUTCDay() || 7; // domingo (0) passa a 7
  t.setUTCDate(t.getUTCDate() + 4 - diaSemana); // recua/avança para a quinta-feira da semana
  const inicioAno = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7);
}

const iso = (d: Date) => d.toLocaleDateString('en-CA');

/** As semanas que cobrem o mês, de segunda a domingo, sem sobrar nem faltar. */
function semanasDoMes(ano: number, mes: number): Date[][] {
  const primeiro = new Date(ano, mes, 1);
  const recuo = (primeiro.getDay() || 7) - 1; // quantos dias até à segunda anterior
  const cursor = new Date(ano, mes, 1 - recuo);
  const ultimo = new Date(ano, mes + 1, 0);
  const semanas: Date[][] = [];
  while (cursor <= ultimo || semanas.length === 0) {
    const semana: Date[] = [];
    for (let i = 0; i < 7; i++) {
      semana.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
  }
  return semanas;
}

export default function MesPanel({ onPickDay }: { onPickDay?: (dia: string) => void }) {
  const { settings } = useAuth();
  const hoje = useMemo(() => new Date(), []);
  const [ancora, setAncora] = useState(() => new Date(hoje.getFullYear(), hoje.getMonth(), 1));

  const ano = ancora.getFullYear();
  const mes = ancora.getMonth();
  const semanas = useMemo(() => semanasDoMes(ano, mes), [ano, mes]);

  // O pedido cobre a grelha inteira, incluindo os dias do mês vizinho que
  // completam a primeira e a última semana — senão esses apareciam sempre
  // vazios e liam-se como dias sem nada marcado.
  const de = iso(semanas[0][0]);
  const ate = iso(semanas[semanas.length - 1][6]);
  const consulta = useQuery<Appointment[]>(`/appointments?from=${de}&to=${ate}&limit=1000`);
  const marcacoes = consulta.data ?? [];

  const porDia = useMemo(() => {
    const mapa = new Map<string, Appointment[]>();
    for (const a of marcacoes) {
      const chave = String(a.appt_date || '').slice(0, 10);
      if (!chave) continue;
      const lista = mapa.get(chave);
      if (lista) lista.push(a);
      else mapa.set(chave, [a]);
    }
    for (const lista of mapa.values()) {
      lista.sort((x, y) => String(x.start_time || '').localeCompare(String(y.start_time || '')));
    }
    return mapa;
  }, [marcacoes]);

  const corDoEstado = (s: string) => settings?.STATUS_META?.[s]?.color || 'var(--text-secondary)';
  const rotuloDoMes = ancora.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  const hojeISO = iso(hoje);

  return (
    <WorkSection
      title={rotuloDoMes}
      count={consulta.loading ? null : `${marcacoes.length} marcações`}
      tools={
        <>
          <GhostBtn onClick={() => setAncora(new Date(ano, mes - 1, 1))} aria-label="Mês anterior">
            ‹
          </GhostBtn>
          <GhostBtn onClick={() => setAncora(new Date(hoje.getFullYear(), hoje.getMonth(), 1))}>Hoje</GhostBtn>
          <GhostBtn onClick={() => setAncora(new Date(ano, mes + 1, 1))} aria-label="Mês seguinte">
            ›
          </GhostBtn>
        </>
      }
    >
      {consulta.error ? (
        <ErrorState error={consulta.error} onRetry={consulta.refetch} message="Não foi possível ler a agenda." />
      ) : consulta.loading && !marcacoes.length ? (
        <Spinner />
      ) : (
        <div className="monthcal">
          <div className="monthcal-grid">
            {/* «sem.» com ponto, e não «sem»: em maiúsculas e ao lado de SEG/TER/QUA,
                a forma sem ponto lê-se como a preposição «sem». O ponto marca a
                abreviatura e desfaz a leitura errada. */}
            <div className="monthcal-head" title="Semana ISO">
              sem.
            </div>
            {DIAS.map((d) => (
              <div key={d} className="monthcal-head">
                {d}
              </div>
            ))}

            {semanas.map((semana) => (
              <Semana
                key={iso(semana[0])}
                semana={semana}
                mes={mes}
                hojeISO={hojeISO}
                porDia={porDia}
                corDoEstado={corDoEstado}
                onPickDay={onPickDay}
              />
            ))}
          </div>
        </div>
      )}
    </WorkSection>
  );
}

function Semana({
  semana,
  mes,
  hojeISO,
  porDia,
  corDoEstado,
  onPickDay,
}: {
  semana: Date[];
  mes: number;
  hojeISO: string;
  porDia: Map<string, Appointment[]>;
  corDoEstado: (s: string) => string;
  onPickDay?: (dia: string) => void;
}) {
  return (
    <>
      <div className="monthcal-wk">{semanaISO(semana[0])}</div>
      {semana.map((d) => {
        const chave = iso(d);
        const doMes = d.getMonth() === mes;
        const lista = porDia.get(chave) || [];
        const emRisco = lista.filter((a) => (a.risk_score || 0) >= 60).length;
        const visiveis = lista.slice(0, MAX_POR_CELULA);
        const escondidas = lista.length - visiveis.length;

        return (
          <div key={chave} className="monthcal-cell" data-outside={doMes ? undefined : 'true'}>
            <div className="monthcal-daybar">
              <button
                type="button"
                className="monthcal-day"
                data-today={chave === hojeISO ? 'true' : undefined}
                onClick={() => onPickDay?.(chave)}
                aria-label={`Ver as marcações de ${d.toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}`}
              >
                {d.getDate()}
              </button>
              {lista.length > 0 && (
                <span className="monthcal-tally">
                  {lista.length}
                  {emRisco > 0 ? <b title={`${emRisco} em risco de falta`}>{emRisco}!</b> : null}
                </span>
              )}
            </div>

            {visiveis.map((a) => {
              const cor = corDoEstado(a.status);
              return (
                <button
                  type="button"
                  key={a.id}
                  className="mevent"
                  data-risky={(a.risk_score || 0) >= 60 ? 'true' : undefined}
                  onClick={() => onPickDay?.(chave)}
                  style={{
                    background: over(cor, 12),
                    borderLeftColor: cor,
                    boxShadow: `inset 0 0 0 1px ${tint(cor, 22)}`,
                  }}
                  title={`${String(a.start_time || '').slice(0, 5)} · ${a.patient_name || ''} · ${a.type || ''}`}
                >
                  <span className="mevent-t" style={{ color: cor }}>
                    {String(a.start_time || '').slice(0, 5)}
                  </span>
                  <span className="mevent-n">{a.patient_name || '—'}</span>
                </button>
              );
            })}

            {escondidas > 0 && (
              <button type="button" className="monthcal-more" onClick={() => onPickDay?.(chave)}>
                +{escondidas} mais
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
