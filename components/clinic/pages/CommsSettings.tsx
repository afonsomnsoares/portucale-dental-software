'use client';
// ─── Canais e autonomia ─────────────────────────────────────────────────────
// O ecrã onde a clínica decide se a IA pode falar sozinha com um doente. É a decisão
// de produto mais consequente que uma clínica toma aqui — o cabeçalho de
// lib/conversationCalc.ts diz isso por escrito.
//
// ─── Porque é que os quatro degraus aparecem todos, sempre ──────────────────
// Um seletor com quatro opções e uma frase por baixo esconderia o que a escolha
// significa. Os degraus estão à vista com a nota completa de cada um (AUTONOMY_NOTES),
// porque quem escolhe tem de conseguir comparar — e porque a diferença entre
// «informational» e «transactional» é a diferença entre responder a uma pergunta e agir
// em nome da clínica.
//
// As duas garantias que não dependem deste ecrã aparecem em primeiro lugar e não são
// configuráveis: o pedido de não contacto é sempre processado, e tudo o que seja clínico
// escala sempre. Não são definições — são a fronteira do produto.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { FormField, Inp, PageHeader, PrimaryBtn, Spinner, Textarea } from '@/components/ui';

interface Nivel {
  value: string;
  label: string;
  note: string;
}
interface Settings {
  autonomyLevel: string;
  openingHours: string;
  addressText: string;
  acknowledgement: string;
  quietHoursStart: string;
  quietHoursEnd: string;
}

// O que cada degrau acima de 'acknowledge' exige que esteja preenchido. A rota recusa
// gravar sem isto (com 400); dizê-lo aqui evita que a pessoa descubra ao carregar.
const EXIGE_FACTOS = new Set(['informational', 'transactional']);

export default function CommsSettings() {
  const { api } = useAuth();
  const [s, setS] = useState<Settings | null>(null);
  const [niveis, setNiveis] = useState<Nivel[]>([]);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  const carregar = useCallback(async () => {
    try {
      const r = await api('/conversations/settings');
      setS(r?.settings || null);
      setNiveis(r?.levels || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as definições.');
    }
  }, [api]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const gravar = useCallback(async () => {
    if (!s) return;
    setAGravar(true);
    setErro('');
    setOk('');
    try {
      await api('/conversations/settings', { method: 'PUT', body: s });
      setOk('Guardado.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível guardar.');
    } finally {
      setAGravar(false);
    }
  }, [api, s]);

  if (!s) return erro ? <div style={{ color: 'var(--urgency-critical)' }}>{erro}</div> : <Spinner />;

  const faltamFactos = EXIGE_FACTOS.has(s.autonomyLevel) && (!s.openingHours.trim() || !s.addressText.trim());

  return (
    <div style={{ maxWidth: '48rem' }}>
      <PageHeader
        title="Canais e Autonomia"
        sub="Quanto é que o sistema pode responder sozinho a um doente. O valor de repouso é «desligada», e é uma decisão vossa, não nossa."
      />

      {/* ── O que nunca muda ── */}
      <div
        style={{
          background: 'var(--bg-sunken)',
          borderRadius: 'var(--radius-card)',
          padding: '12px 16px',
          marginBottom: 20,
          fontSize: 'var(--text-xs)',
          lineHeight: 'var(--text-xs-leading)',
        }}
      >
        <div style={{ fontWeight: 'var(--weight-bold)', marginBottom: 4 }}>Duas coisas não dependem desta página</div>
        Um pedido para não voltar a ser contactado é <b>sempre</b> processado, em qualquer degrau — é retirada de
        consentimento, não uma funcionalidade. E qualquer assunto clínico (dor, inchaço, sangramento, febre, um dente
        partido) <b>escala sempre</b> para uma pessoa, sem resposta automática.
      </div>

      {/* ── Os quatro degraus ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {niveis.map((n) => {
          const escolhido = n.value === s.autonomyLevel;
          return (
            <button
              key={n.value}
              type="button"
              onClick={() => setS({ ...s, autonomyLevel: n.value })}
              style={{
                textAlign: 'left',
                padding: '11px 14px',
                borderRadius: 'var(--radius-card)',
                border: `1px solid ${escolhido ? 'var(--accent)' : 'var(--border-subtle)'}`,
                background: escolhido ? 'var(--accent-bg)' : 'var(--bg-surface)',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    flexShrink: 0,
                    border: `2px solid ${escolhido ? 'var(--accent)' : 'var(--border-strong)'}`,
                    background: escolhido ? 'var(--accent)' : 'transparent',
                  }}
                />
                <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>{n.label}</span>
              </div>
              <div
                style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: 4, paddingLeft: 17 }}
              >
                {n.note}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Os factos que a IA pode citar ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <FormField
          label="Horário de funcionamento"
          hint="Citado tal e qual numa resposta automática. Se estiver vazio, o sistema não responde a «a que horas abrem?» — prefere não saber a inventar."
        >
          <Inp
            value={s.openingHours}
            onChange={(e) => setS({ ...s, openingHours: e.target.value })}
            placeholder="Seg a Sex, 9h00–19h00. Sábado, 9h00–13h00."
          />
        </FormField>

        <FormField label="Morada e como chegar" hint="Idem para «onde ficam?» e «há estacionamento?».">
          <Textarea
            value={s.addressText}
            onChange={(e) => setS({ ...s, addressText: e.target.value })}
            rows={2}
            placeholder="Rua … , Porto. Estacionamento gratuito no parque em frente."
          />
        </FormField>

        <FormField
          label="Mensagem de aceitação"
          hint="O que sai no degrau «só acusa a receção». Vazio usa uma frase neutra."
        >
          <Inp
            value={s.acknowledgement}
            onChange={(e) => setS({ ...s, acknowledgement: e.target.value })}
            placeholder="Recebemos a sua mensagem. Respondemos assim que possível."
          />
        </FormField>

        <div className="grid-pair" style={{ gap: 12 }}>
          <FormField label="Silêncio a partir de" hint="Nada automático sai entre estas horas.">
            <Inp
              type="time"
              value={s.quietHoursStart}
              onChange={(e) => setS({ ...s, quietHoursStart: e.target.value })}
            />
          </FormField>
          <FormField label="Até" hint="Uma resposta às 3h da manhã assusta mais do que ajuda.">
            <Inp type="time" value={s.quietHoursEnd} onChange={(e) => setS({ ...s, quietHoursEnd: e.target.value })} />
          </FormField>
        </div>
      </div>

      {faltamFactos && (
        <div
          style={{
            marginTop: 16,
            background: 'var(--urgency-soon-bg)',
            color: 'var(--urgency-soon)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-control)',
            fontSize: 'var(--text-xs)',
          }}
        >
          Este degrau responde a perguntas de facto — precisa do horário e da morada preenchidos para ter o que
          responder. Sem eles, não é possível guardar.
        </div>
      )}

      {erro && (
        <div style={{ marginTop: 12, color: 'var(--urgency-critical)', fontSize: 'var(--text-sm)' }}>{erro}</div>
      )}
      {ok && <div style={{ marginTop: 12, color: 'var(--urgency-ok)', fontSize: 'var(--text-sm)' }}>{ok}</div>}

      <div style={{ marginTop: 20 }}>
        <PrimaryBtn onClick={gravar} disabled={aGravar || faltamFactos}>
          {aGravar ? 'A guardar…' : 'Guardar'}
        </PrimaryBtn>
      </div>
    </div>
  );
}
