'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/app/providers';
import type { Appointment } from '@/lib/types';
import { Badge, over, RiskBadge, tint } from './ui';

// Alguns chamadores ainda passam as chaves antigas `time`/`patient` ao lado das colunas reais.
type CalendarAppointment = Appointment & { time?: string; patient?: string };

// ─── Porque é que a cor NÃO se concatena ────────────────────────────────────
// A versão anterior escrevia `${stColor}10` para obter o mesmo tom a 6% de alfa.
// Isso só funciona enquanto `statuses.color` for um hex — e a migração 054
// (`054_status_colors_as_tokens.sql`, ainda por correr nesta base) converte-os
// precisamente para `var(--urgency-soon)` e companhia, para a paleta poder ser
// auditada em app/globals.css em vez de viver na base de dados.
//
// No dia em que essa migração correr, `var(--urgency-soon)10` deixa de ser uma
// cor válida, a declaração é descartada em silêncio, e os blocos da agenda
// perdem o fundo sem um único erro na consola. `color-mix` aceita as duas
// formas e é o que torna o componente indiferente ao formato guardado.
// Definidos em components/ui.tsx — uma só definição para o produto inteiro.

const MIN_PX_PER_HOUR = 56;
const MAX_PX_PER_HOUR = 132;
const GUTTER = 60;
const DEFAULT_OPEN = 8;
const DEFAULT_CLOSE = 20;

function toMins(t = '00:00') {
  const [h = '0', m = '0'] = String(t).split(':');
  return Number(h) * 60 + Number(m);
}
const hhmm = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const startOf = (a: CalendarAppointment) => toMins(a.start_time || a.time || '09:00');
const endOf = (a: CalendarAppointment) => startOf(a) + Math.max(5, a.duration || 30);

// ─── Sobreposição a sério ───────────────────────────────────────────────────
// O que estava aqui era `laneOffset = (idx % 2) * 8`: a posição de uma marcação
// dependia da PARIDADE DO ÍNDICE no array, não de haver ou não conflito. Duas
// marcações à mesma hora com índices ambos pares desenhavam-se exatamente uma
// por cima da outra — e duas que nem se tocavam apareciam desencontradas por
// nada. Era uma imitação de layout, e escondia justamente o caso que uma agenda
// existe para mostrar.
//
// Isto é o algoritmo verdadeiro, em duas fases:
//   1. Agrupar em CACHOS — conjuntos de marcações ligadas por sobreposição.
//      Cada cacho é independente, por isso um conflito às 9h não estreita a
//      tarde inteira, que é o defeito da versão ingénua deste cálculo.
//   2. Dentro do cacho, atribuir a primeira pista livre (guloso sobre o fim de
//      cada pista). A largura é 1/nº de pistas DO CACHO.
function layoutLanes(items: CalendarAppointment[]) {
  const sorted = [...items].sort((a, b) => startOf(a) - startOf(b) || endOf(a) - endOf(b));
  const placed = new Map<string, { lane: number; of: number }>();

  let cluster: CalendarAppointment[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assigned: Array<{ id: string; lane: number }> = [];
    for (const a of cluster) {
      let lane = laneEnds.findIndex((end) => end <= startOf(a));
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = endOf(a);
      assigned.push({ id: a.id, lane });
    }
    for (const { id, lane } of assigned) placed.set(id, { lane, of: laneEnds.length });
    cluster = [];
    clusterEnd = -1;
  };

  for (const a of sorted) {
    if (cluster.length && startOf(a) >= clusterEnd) flush();
    cluster.push(a);
    clusterEnd = Math.max(clusterEnd, endOf(a));
  }
  flush();
  return placed;
}

interface DayCalendarProps {
  appointments?: CalendarAppointment[];
  date?: string;
  onStatusChange?: (id: string, nextStatus: string) => Promise<void> | void;
}

export default function DayCalendar({ appointments = [], date, onStatusChange }: DayCalendarProps) {
  const { settings } = useAuth();
  const [selected, setSelected] = useState<CalendarAppointment | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(76);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);

  const statusColor = (s: string) => settings?.STATUS_META?.[s]?.color || 'var(--accent)';
  const statusLabel = (s: string) => settings?.STATUS_META?.[s]?.label || String(s || '').replace(/-/g, ' ');

  const nextStatus = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(settings?.STATUS_TRANSITIONS || {})) {
      if (v?.length) map[k] = v[0];
    }
    return map;
  }, [settings?.STATUS_TRANSITIONS]);

  // ─── Colunas por cadeira: só quando a cadeira DIZ alguma coisa ────────────
  // `appointments.chair` é NOT NULL na base, mas hoje ninguém lhe atribui valor:
  // nenhum formulário de marcação envia `body.chair`, e app/api/appointments/
  // route.ts:91 resolve a ausência com `|| 1`. Ou seja, todas as marcações estão
  // na cadeira 1 — por omissão, não por decisão.
  //
  // A primeira versão disto derivava as colunas de `tenants.operatories` (4 na
  // Clínica Portucale) e o resultado era quatro colunas rotuladas com três delas
  // permanentemente vazias: andaimes de uma funcionalidade que não existe. Uma
  // capacidade DECLARADA não é a mesma coisa que uma dimensão USADA, e só a
  // segunda merece ocupar espaço no ecrã.
  //
  // Por isso as colunas saem do que as marcações do dia efetivamente usam. Com
  // uma só cadeira em uso — o caso de hoje, e de qualquer clínica que não faça
  // essa gestão — a agenda é uma coluna limpa, sem cabeçalho nenhum. No dia em
  // que a marcação passar a atribuir cadeira, as colunas aparecem sozinhas, sem
  // aqui se tocar.
  const chairs = useMemo(() => {
    const used = new Set<number>();
    for (const a of appointments) used.add(Math.max(1, Number(a.chair) || 1));
    return used.size ? [...used].sort((x, y) => x - y) : [1];
  }, [appointments]);

  // Abaixo de duas cadeiras não há dimensão a mostrar — há uma coluna.
  const multiChair = chairs.length > 1;

  // A janela do dia sai do que existe, não de um 07–17 fixo que fazia
  // desaparecer sem aviso tudo o que caísse fora dele.
  const [openH, closeH] = useMemo(() => {
    let min = DEFAULT_OPEN * 60;
    let max = DEFAULT_CLOSE * 60;
    for (const a of appointments) {
      min = Math.min(min, startOf(a));
      max = Math.max(max, endOf(a));
    }
    return [Math.floor(min / 60), Math.ceil(max / 60)];
  }, [appointments]);

  const hours = useMemo(
    () => Array.from({ length: Math.max(1, closeH - openH) }, (_, i) => openH + i),
    [openH, closeH],
  );
  const pxPerHour = Math.min(MAX_PX_PER_HOUR, Math.max(MIN_PX_PER_HOUR, zoom));
  const topFor = (mins: number) => (mins - openH * 60) * (pxPerHour / 60);
  const totalHeight = hours.length * pxPerHour;

  const byChair = useMemo(() => {
    const map = new Map<number, CalendarAppointment[]>();
    for (const c of chairs) map.set(c, []);
    for (const a of appointments) {
      map.get(Math.max(1, Number(a.chair) || 1))?.push(a);
    }
    return map;
  }, [appointments, chairs]);

  const lanes = useMemo(() => {
    const all = new Map<string, { lane: number; of: number }>();
    for (const list of byChair.values()) for (const [k, v] of layoutLanes(list)) all.set(k, v);
    return all;
  }, [byChair]);

  // ─── O «agora» tem de andar ───────────────────────────────────────────────
  // Era `new Date()` lido no corpo do render, sem mais nada a mexer-lhe: a linha
  // vermelha ficava parada na hora em que a página carregou. Numa agenda que a
  // receção deixa aberta o dia inteiro — que é exatamente como esta é usada — ao
  // fim da tarde a linha aponta para a manhã. Um indicador de tempo errado é pior
  // do que nenhum, porque ninguém desconfia dele.
  //
  // De minuto a minuto: é a resolução do próprio indicador, e mais do que isso
  // seria acordar o React sem nada mudar no ecrã.
  const [nowMins, setNowMins] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNowMins(d.getHours() * 60 + d.getMinutes());
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  const isToday = !date || date === new Date().toLocaleDateString('en-CA');
  const showNow = isToday && nowMins >= openH * 60 && nowMins <= closeH * 60;

  // Abrir a agenda às 15h e aterrar nas 08h é obrigar toda a gente ao mesmo
  // scroll, todos os dias. Uma vez, à montagem, e nunca mais — para não roubar
  // a posição a quem está a navegar.
  useEffect(() => {
    if (didScroll.current || !showNow || !scrollRef.current) return;
    didScroll.current = true;
    // O cálculo é feito aqui em vez de reutilizar topFor(): essa função nasce
    // nova a cada render e como dependência faria o efeito correr sempre —
    // roubando a posição a quem estivesse a navegar na agenda.
    scrollRef.current.scrollTop = Math.max(0, (nowMins - openH * 60) * (pxPerHour / 60) - 140);
  }, [showNow, nowMins, openH, pxPerHour]);

  async function advance(apt: CalendarAppointment) {
    const next = nextStatus[apt.status];
    if (!next || !onStatusChange) return;
    setLoading(true);
    try {
      await onStatusChange(apt.id, next);
      setSelected((s) => (s?.id === apt.id ? { ...s, status: next } : s));
    } finally {
      setLoading(false);
    }
  }

  const colWidth = `calc((100% - ${GUTTER}px) / ${chairs.length})`;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="card" style={{ flex: '1 1 520px', minWidth: 0, overflow: 'hidden' }}>
        {/* ─── Cabeçalho: data, contagem e densidade ─────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              {date
                ? new Date(`${date}T00:00:00`).toLocaleDateString('pt-PT', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })
                : 'Hoje'}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {appointments.length === 0
                ? 'Sem marcações'
                : `${appointments.length} marcaç${appointments.length === 1 ? 'ão' : 'ões'}${multiChair ? ` · ${chairs.length} cadeiras` : ''}`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setZoom((z) => Math.max(MIN_PX_PER_HOUR, z - 20))}
              disabled={pxPerHour <= MIN_PX_PER_HOUR}
              aria-label="Reduzir a altura das horas"
            >
              −
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setZoom((z) => Math.min(MAX_PX_PER_HOUR, z + 20))}
              disabled={pxPerHour >= MAX_PX_PER_HOUR}
              aria-label="Aumentar a altura das horas"
            >
              +
            </button>
          </div>
        </div>

        {/* ─── Cabeçalho das cadeiras, fixo ao rolar ──────────────────────── */}
        {/* Só quando há mais do que uma: rotular a única coluna com «Cadeira 1»
            é ocupar uma faixa inteira para não dizer nada. */}
        {multiChair && (
          <div
            style={{
              display: 'flex',
              position: 'sticky',
              top: 0,
              zIndex: 4,
              background: 'var(--bg-surface)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ width: GUTTER, flexShrink: 0 }} />
            {chairs.map((c) => (
              <div
                key={c}
                className="section-label"
                style={{
                  width: colWidth,
                  padding: '8px 10px',
                  margin: 0,
                  borderLeft: '1px solid var(--border-subtle)',
                  textAlign: 'center',
                }}
              >
                Cadeira {c}
              </div>
            ))}
          </div>
        )}

        {/* `62vh` era o mesmo tipo de número mágico que o `calc(100vh - 320px)`
            que aqui estava antes: adivinha a altura do que está por cima em vez
            de a medir. `dvh` acompanha a barra do browser no telemóvel, e o
            mínimo em px impede que num ecrã baixo a grelha fique com duas horas
            visíveis. */}
        <div
          ref={scrollRef}
          style={{ overflowY: 'auto', maxHeight: 'max(320px, calc(100dvh - 300px))', position: 'relative' }}
        >
          <div style={{ position: 'relative', height: totalHeight }}>
            {/* Faixas horárias alternadas — substituem as linhas tracejadas de
                meia hora, que só acrescentavam ruído a uma grelha que já tinha
                uma linha por hora. */}
            {hours.map((h, i) => (
              <div
                key={h}
                style={{
                  position: 'absolute',
                  top: i * pxPerHour,
                  left: 0,
                  right: 0,
                  height: pxPerHour,
                  background: i % 2 ? 'var(--bg-sunken)' : 'transparent',
                  borderBottom: '1px solid var(--border-subtle)',
                  pointerEvents: 'none',
                }}
              />
            ))}

            {/* Goteira das horas */}
            {hours.map((h, i) => (
              <div
                key={`g${h}`}
                className="text-xs font-mono"
                style={{
                  position: 'absolute',
                  top: i * pxPerHour + 4,
                  left: 0,
                  width: GUTTER,
                  paddingRight: 8,
                  textAlign: 'right',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                }}
              >
                {String(h).padStart(2, '0')}:00
              </div>
            ))}

            {/* Separadores verticais entre cadeiras — nenhum a dividir uma coluna só */}
            {(multiChair ? chairs : []).map((c, i) => (
              <div
                key={`v${c}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `calc(${GUTTER}px + ${i} * ${colWidth})`,
                  borderLeft: '1px solid var(--border-subtle)',
                  pointerEvents: 'none',
                }}
              />
            ))}

            {/* ─── Marcações ───────────────────────────────────────────── */}
            {chairs.map((chair, ci) =>
              (byChair.get(chair) || []).map((apt) => {
                const s = startOf(apt);
                const e = endOf(apt);
                const { lane = 0, of = 1 } = lanes.get(apt.id) || {};
                const color = statusColor(apt.status);
                const isSel = selected?.id === apt.id;
                // Sem teto, `Math.max(..., 26)` fazia uma consulta de 15 min ocupar
                // 26px onde só lhe cabiam 14 na densidade mínima — e transbordar
                // por cima da seguinte. O mínimo continua a existir (um bloco de
                // 4px não se lê), mas nunca ultrapassa o espaço real da marcação.
                const exact = (e - s) * (pxPerHour / 60);
                const height = Math.max(Math.min(26, exact), exact - 3);
                const risky = (apt.risk_score || 0) >= 60;

                return (
                  <button
                    type="button"
                    key={apt.id}
                    onClick={() => setSelected(isSel ? null : apt)}
                    aria-pressed={isSel}
                    aria-label={`${hhmm(s)} às ${hhmm(e)}${multiChair ? `, cadeira ${chair}` : ''}, ${apt.patient_name || apt.patient || 'sem nome'}, ${apt.type}, ${statusLabel(apt.status)}${risky ? ', risco elevado de falta' : ''}`}
                    style={{
                      position: 'absolute',
                      top: topFor(s) + 2,
                      left: `calc(${GUTTER}px + ${ci} * ${colWidth} + ${lane} * (${colWidth} / ${of}) + 3px)`,
                      width: `calc((${colWidth} / ${of}) - 6px)`,
                      height,
                      font: 'inherit',
                      textAlign: 'left',
                      // Fundo sólido sobre a superfície, não um alfa de 6% que
                      // deixava os blocos quase brancos e ilegíveis.
                      background: over(color, isSel ? 22 : 12),
                      border: `1px solid ${tint(color, isSel ? 90 : 35)}`,
                      borderLeft: `3px solid ${color}`,
                      borderRadius: 'var(--radius-control)',
                      padding: height > 40 ? '5px 8px' : '2px 8px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'background 0.12s, border-color 0.12s, box-shadow 0.12s',
                      boxShadow: isSel ? 'var(--elev-2)' : 'var(--elev-0)',
                      zIndex: isSel ? 3 : 2,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                      <span className="text-2xs font-mono" style={{ color, flexShrink: 0, fontWeight: 700 }}>
                        {hhmm(s)}
                      </span>
                      <span
                        className="text-xs font-bold truncate"
                        style={{ color: 'var(--text-primary)', minWidth: 0 }}
                      >
                        {apt.patient_name || apt.patient || '—'}
                      </span>
                      {risky && (
                        <span
                          aria-hidden="true"
                          title="Risco elevado de falta"
                          style={{
                            marginLeft: 'auto',
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'var(--urgency-critical)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </div>
                    {height > 40 && (
                      <div className="text-2xs truncate" style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                        {apt.type}
                      </div>
                    )}
                    {height > 62 && (
                      <div className="text-2xs truncate" style={{ color, marginTop: 3, fontWeight: 600 }}>
                        {statusLabel(apt.status)}
                      </div>
                    )}
                  </button>
                );
              }),
            )}

            {/* ─── Linha do agora ──────────────────────────────────────── */}
            {showNow && (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: topFor(nowMins),
                  zIndex: 5,
                  pointerEvents: 'none',
                }}
              >
                <div
                  className="text-2xs font-mono"
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: -8,
                    width: GUTTER - 6,
                    textAlign: 'right',
                    color: 'var(--urgency-critical)',
                    fontWeight: 700,
                  }}
                >
                  {hhmm(nowMins)}
                </div>
                <div style={{ marginLeft: GUTTER, height: 2, background: 'var(--urgency-critical)' }} />
              </div>
            )}

            {appointments.length === 0 && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'none',
                }}
              >
                <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nada marcado para este dia.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Painel de detalhe ─────────────────────────────────────────── */}
      {selected && (
        <aside
          className="card"
          aria-label="Detalhe da marcação"
          style={{
            flex: '0 1 280px',
            minWidth: 240,
            padding: 18,
            alignSelf: 'flex-start',
            borderTop: `3px solid ${statusColor(selected.status)}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              {selected.patient_name || selected.patient || 'Marcação'}
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label="Fechar detalhe"
              className="btn btn-icon btn-secondary"
            >
              ×
            </button>
          </div>

          {(
            [
              ['Horário', `${hhmm(startOf(selected))} – ${hhmm(endOf(selected))}`],
              ['Duração', `${selected.duration || 30} min`],
              // A cadeira só entra quando distingue: com uma só, «Cadeira 1» é
              // uma linha que diz sempre o mesmo a toda a gente.
              ...(multiChair ? ([['Cadeira', String(selected.chair || 1)]] as const) : []),
              ['Dentista', selected.dentist_name || '—'],
              ['Tipo', selected.type],
            ] as const
          ).map(([k, v]) => (
            <div
              key={k}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '7px 0',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {k}
              </span>
              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)', textAlign: 'right' }}>
                {v}
              </span>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
            <Badge s={selected.status} />
            {(selected.risk_score || 0) > 0 && <RiskBadge score={selected.risk_score || 0} />}
          </div>

          {(selected.risk_score || 0) >= 60 && (
            <div
              className="text-xs"
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 'var(--radius-control)',
                background: 'var(--urgency-critical-bg)',
                color: 'var(--urgency-critical)',
                border: '1px solid var(--urgency-critical-border)',
                lineHeight: 1.5,
              }}
            >
              <strong>Ação necessária:</strong> risco elevado de falta. Ligar ao doente para confirmar.
            </div>
          )}

          {nextStatus[selected.status] && onStatusChange && (
            <button
              type="button"
              onClick={() => advance(selected)}
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
            >
              {loading ? 'A atualizar…' : `Passar a ${statusLabel(nextStatus[selected.status]).toLowerCase()}`}
            </button>
          )}
        </aside>
      )}
    </div>
  );
}
