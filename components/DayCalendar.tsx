'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/app/providers';
import type { Appointment } from '@/lib/types';
import { Badge, over, RiskBadge, tint } from './ui';

// Alguns chamadores ainda passam as chaves antigas `time`/`patient` ao lado das colunas reais.
type CalendarAppointment = Appointment & { time?: string; patient?: string };

// ─── Porque é que a cor NÃO se concatena ────────────────────────────────────
// `${stColor}10` só funciona enquanto `statuses.color` for um hex — e a migração 054
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
const GUTTER = 58; // tem de casar com .dayrail em app/globals.css
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
  /**
   * Chamado ao carregar num buraco da agenda, com a hora em que ele começa
   * («09:45»). Sem isto os buracos continuam a desenhar-se — saber que existem
   * já vale — mas não são clicáveis.
   */
  onBookAt?: (startTime: string) => void;
}

export default function DayCalendar({ appointments = [], date, onStatusChange, onBookAt }: DayCalendarProps) {
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

  // ─── Os buracos da agenda ─────────────────────────────────────────────────
  // Entre o fim de uma consulta e o início da seguinte. Calculados sobre a união
  // dos intervalos ocupados (e não sobre a lista ordenada), senão duas consultas
  // sobrepostas inventavam um buraco onde não há nenhum.
  const buracos = useMemo(() => {
    if (chairs.length > 1) return []; // com várias cadeiras, «livre» é por cadeira — outra conta
    const ocupados = [...appointments].map((a) => [startOf(a), endOf(a)] as const).sort((x, y) => x[0] - y[0]);
    const uniao: Array<[number, number]> = [];
    for (const [ini, fim] of ocupados) {
      const ultimo = uniao[uniao.length - 1];
      if (ultimo && ini <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fim);
      else uniao.push([ini, fim]);
    }
    const out: Array<{ ini: number; fim: number }> = [];
    for (let i = 0; i < uniao.length - 1; i++) {
      const ini = uniao[i][1];
      const fim = uniao[i + 1][0];
      if (fim - ini >= 20 && (!isToday || fim > nowMins)) out.push({ ini, fim });
    }
    return out;
  }, [appointments, chairs.length, isToday, nowMins]);

  // ─── O que vem a seguir ───────────────────────────────────────────────────
  // A pergunta mais feita ao balcão, e a que a grelha obrigava a responder a
  // olho: varrer as horas à procura do primeiro bloco depois do agora. Aqui é
  // uma lista, e ocupa a coluna da direita sempre que não há nada escolhido.
  const proximas = useMemo(() => {
    if (!isToday) return [...appointments].sort((a, b) => startOf(a) - startOf(b)).slice(0, 8);
    return [...appointments]
      .filter((a) => endOf(a) > nowMins && !['departed', 'no-show', 'cancelled'].includes(a.status))
      .sort((a, b) => startOf(a) - startOf(b))
      .slice(0, 8);
  }, [appointments, isToday, nowMins]);

  return (
    <div className="daygrid">
      <div style={{ minWidth: 0 }}>
        {/* A régua de comando. Os rótulos de cadeira só aparecem quando há mais
            do que uma — rotular a coluna única com «cadeira_1» é gastar uma faixa
            para não dizer nada — mas a régua existe sempre, porque é onde vive a
            densidade. */}
        <div className="dayhead">
          {multiChair ? (
            <>
              <div style={{ width: GUTTER, flexShrink: 0 }} />
              {chairs.map((c) => (
                <div
                  key={c}
                  className="section-label"
                  style={{ width: colWidth, padding: 4, margin: 0, textAlign: 'center' }}
                >
                  cadeira_{c}
                </div>
              ))}
            </>
          ) : null}
          <div className="dayhead-zoom">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(MIN_PX_PER_HOUR, z - 20))}
              disabled={pxPerHour <= MIN_PX_PER_HOUR}
              aria-label="Comprimir as horas"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(MAX_PX_PER_HOUR, z + 20))}
              disabled={pxPerHour >= MAX_PX_PER_HOUR}
              aria-label="Esticar as horas"
            >
              +
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="daygrid-scroll">
          <div style={{ position: 'relative', height: totalHeight }}>
            {/* Faixas horárias alternadas, por baixo de tudo. */}
            {hours.map((h, i) => (
              <div
                key={h}
                style={{
                  position: 'absolute',
                  top: i * pxPerHour,
                  left: GUTTER,
                  right: 0,
                  height: pxPerHour,
                  background: i % 2 ? 'var(--bg-sunken)' : 'transparent',
                  borderBottom: '1px solid var(--border-subtle)',
                  pointerEvents: 'none',
                }}
              />
            ))}

            {/* A régua das horas: uma coluna com fundo, não números a flutuar. */}
            <div className="dayrail">
              {hours.map((h, i) => (
                <span key={`g${h}`} className="dayrail-h" style={{ top: i * pxPerHour }}>
                  {String(h).padStart(2, '0')}
                </span>
              ))}
            </div>

            {(multiChair ? chairs : []).slice(1).map((c, i) => (
              <div
                key={`v${c}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `calc(${GUTTER}px + ${i + 1} * ${colWidth})`,
                  borderLeft: '1px solid var(--border-subtle)',
                  pointerEvents: 'none',
                }}
              />
            ))}

            {buracos.map(({ ini, fim }) => {
              const altura = (fim - ini) * (pxPerHour / 60) - 6;
              if (altura < 14) return null;
              const mins = fim - ini;
              const rotulo =
                mins >= 60
                  ? `${Math.floor(mins / 60)}h${mins % 60 ? String(mins % 60).padStart(2, '0') : ''}`
                  : `${mins}min`;
              return (
                <button
                  type="button"
                  key={`buraco-${ini}`}
                  className="daygap"
                  data-static={onBookAt ? undefined : 'true'}
                  onClick={onBookAt ? () => onBookAt(hhmm(ini)) : undefined}
                  aria-label={
                    onBookAt
                      ? `Marcar consulta às ${hhmm(ini)} — ${rotulo} livre`
                      : `${rotulo} livre a partir das ${hhmm(ini)}`
                  }
                  style={{
                    top: topFor(ini) + 3,
                    left: GUTTER + 3,
                    right: 3,
                    height: altura,
                  }}
                >
                  {rotulo} livre{onBookAt ? ' · marcar' : ''}
                </button>
              );
            })}

            {chairs.map((chair, ci) =>
              (byChair.get(chair) || []).map((apt) => {
                const s = startOf(apt);
                const e = endOf(apt);
                const { lane = 0, of = 1 } = lanes.get(apt.id) || {};
                const color = statusColor(apt.status);
                const isSel = selected?.id === apt.id;
                const exact = (e - s) * (pxPerHour / 60);
                const height = Math.max(Math.min(24, exact), exact - 3);
                const risky = (apt.risk_score || 0) >= 60;
                const passou = isToday && e <= nowMins;
                const agora = isToday && s <= nowMins && e > nowMins;

                return (
                  <button
                    type="button"
                    key={apt.id}
                    className="dayblock"
                    data-past={passou ? 'true' : undefined}
                    data-current={agora ? 'true' : undefined}
                    data-selected={isSel ? 'true' : undefined}
                    onClick={() => setSelected(isSel ? null : apt)}
                    aria-pressed={isSel}
                    aria-label={`${hhmm(s)} às ${hhmm(e)}${multiChair ? `, cadeira ${chair}` : ''}, ${apt.patient_name || apt.patient || 'sem nome'}, ${apt.type}, ${statusLabel(apt.status)}${risky ? ', risco elevado de falta' : ''}${passou ? ', já terminou' : ''}${agora ? ', a decorrer agora' : ''}`}
                    style={{
                      top: topFor(s) + 1,
                      left: `calc(${GUTTER}px + ${ci} * ${colWidth} + ${lane} * (${colWidth} / ${of}) + 2px)`,
                      width: `calc((${colWidth} / ${of}) - 4px)`,
                      height,
                      background: over(color, isSel ? 24 : 14),
                      border: `1px solid ${tint(color, isSel ? 90 : 42)}`,
                      borderLeft: `3px solid ${color}`,
                      padding: height > 36 ? '4px 7px' : '1px 7px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                      <span
                        className="text-2xs font-mono"
                        style={{ color, flexShrink: 0, fontWeight: 'var(--weight-bold)' }}
                      >
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
                          className="text-2xs font-mono"
                          style={{
                            marginLeft: 'auto',
                            flexShrink: 0,
                            color: 'var(--urgency-critical)',
                            fontWeight: 'var(--weight-bold)',
                          }}
                        >
                          !
                        </span>
                      )}
                    </div>
                    {height > 36 && (
                      <div className="text-2xs truncate" style={{ color: 'var(--text-secondary)', marginTop: 1 }}>
                        {apt.type}
                      </div>
                    )}
                    {height > 56 && (
                      <div
                        className="text-2xs truncate"
                        style={{ color, marginTop: 2, fontWeight: 'var(--weight-semibold)' }}
                      >
                        {statusLabel(apt.status)}
                      </div>
                    )}
                  </button>
                );
              }),
            )}

            {showNow && (
              <div className="daynow" style={{ top: topFor(nowMins) }}>
                <span className="daynow-chip">{hhmm(nowMins)}</span>
                <div className="daynow-line" />
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

      {/* ─── A coluna que nunca está vazia ───────────────────────────────── */}
      <aside className="daygrid-rail" aria-label={selected ? 'Detalhe da marcação' : 'Próximas marcações'}>
        {selected ? (
          <>
            <div className="daygrid-rail-head">
              <span>marcação</span>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Fechar detalhe"
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  font: 'inherit',
                  lineHeight: 'var(--leading-none)',
                }}
              >
                ✕
              </button>
            </div>
            <div className="daygrid-rail-body">
              <div
                className="text-base font-bold"
                style={{ color: 'var(--text-primary)', marginBottom: 4, overflowWrap: 'anywhere' }}
              >
                {selected.patient_name || selected.patient || 'Marcação'}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                <Badge s={selected.status} />
                {(selected.risk_score || 0) > 0 && <RiskBadge score={selected.risk_score || 0} />}
              </div>

              {(
                [
                  ['horário', `${hhmm(startOf(selected))}–${hhmm(endOf(selected))}`],
                  ['duração', `${selected.duration || 30} min`],
                  ...(multiChair ? ([['cadeira', String(selected.chair || 1)]] as const) : []),
                  ['dentista', selected.dentist_name || '—'],
                  ['tipo', selected.type],
                ] as const
              ).map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '6px 0',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <span
                    className="text-2xs font-mono"
                    style={{ color: 'var(--text-muted)', letterSpacing: 'var(--text-2xs-tracking)' }}
                  >
                    {k}
                  </span>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: 'var(--text-primary)', textAlign: 'right', minWidth: 0 }}
                  >
                    {v}
                  </span>
                </div>
              ))}

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
                    lineHeight: 'var(--leading-prose)',
                  }}
                >
                  <strong>Ligar antes da hora.</strong> Risco elevado de falta.
                </div>
              )}

              {nextStatus[selected.status] && onStatusChange && (
                <button
                  type="button"
                  onClick={() => advance(selected)}
                  disabled={loading}
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
                >
                  {loading ? 'A atualizar…' : `Passar a ${statusLabel(nextStatus[selected.status]).toLowerCase()}`}
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="daygrid-rail-head">
              <span>{isToday ? 'a seguir' : 'o dia'}</span>
              <span style={{ marginLeft: 'auto' }}>{proximas.length}</span>
            </div>
            <div className="daygrid-rail-body">
              {proximas.length === 0 ? (
                <div className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 'var(--leading-prose)' }}>
                  {appointments.length ? 'Já não falta ninguém hoje.' : 'Nada marcado para este dia.'}
                </div>
              ) : (
                proximas.map((a) => (
                  <button type="button" key={a.id} className="daynext" onClick={() => setSelected(a)}>
                    <span className="daynext-when">{hhmm(startOf(a))}</span>
                    <span className="daynext-who">{a.patient_name || a.patient || '—'}</span>
                    {(a.risk_score || 0) >= 60 && (
                      <span
                        className="text-2xs font-mono"
                        title="Risco elevado de falta"
                        style={{
                          marginLeft: 'auto',
                          color: 'var(--urgency-critical)',
                          fontWeight: 'var(--weight-bold)',
                        }}
                      >
                        !
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
