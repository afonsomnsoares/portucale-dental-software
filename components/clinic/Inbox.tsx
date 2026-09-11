'use client';
// ─── A caixa de entrada ─────────────────────────────────────────────────────
// O motor existia inteiro — lib/inbound.ts, lib/conversationCalc.ts, quatro rotas em
// app/api/conversations, três permissões, um classificador de intenções com quatro níveis
// de autonomia — e não havia uma única página que lhe chegasse. Construído, testado, e
// invisível.
//
// Duas colunas e não três: a lista à esquerda, a conversa à direita. Uma caixa de entrada
// ordena-se pelo que precisa de uma pessoa (listConversations já devolve os escalados
// primeiro, depois os que esperam por nós), e o que a receção faz aqui é ler e responder
// — não filtrar por sete eixos.
//
// O que esta página NÃO faz, de propósito: não deixa mudar o nível de autonomia. Essa
// decisão é da direção e vive em Definições → Canais e Autonomia; pô-la ao lado do botão
// de responder seria convidar a mexer nela a meio de uma conversa difícil.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import { Badge, Empty, PageHeader, PrimaryBtn, Spinner, Textarea } from '@/components/ui';
import {
  CHANNEL_LABELS,
  CONVERSATION_STATE_LABELS,
  type ConversationChannel,
  type ConversationState,
  INTENT_LABELS,
} from '@/lib/conversationCalc';

interface ConversationRow {
  id: string;
  patient_id: string | null;
  patient_name: string | null;
  from_addr: string | null;
  channel: ConversationChannel;
  state: ConversationState;
  last_intent: string | null;
  last_body: string | null;
  message_count: number;
  last_message_at: string | null;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  automated: boolean;
  intent: string | null;
  created_at: string;
}

// Os três estados que importam à receção têm cor; os dois de arquivo não. Uma caixa em
// que tudo brilha é uma caixa em que nada se destaca.
const STATE_TONE: Partial<Record<ConversationState, { bg: string; color: string }>> = {
  escalated: { bg: 'var(--urgency-critical-bg)', color: 'var(--urgency-critical)' },
  awaiting_staff: { bg: 'var(--urgency-soon-bg)', color: 'var(--urgency-soon)' },
  awaiting_patient: { bg: 'var(--accent-bg)', color: 'var(--accent)' },
};

function quando(v: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje
    ? d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' });
}

function quemFala(m: Message) {
  if (m.direction === 'inbound') return 'Doente';
  return m.automated ? 'Automático' : 'Clínica';
}

export default function Inbox() {
  const { api } = useAuth();
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Message[]>([]);
  const [detalhe, setDetalhe] = useState<ConversationRow | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [aCarregar, setACarregar] = useState(true);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState('');

  const carregarLista = useCallback(async () => {
    try {
      const data = await api('/conversations');
      setRows(data?.conversations || []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar a caixa de entrada.');
    } finally {
      setACarregar(false);
    }
  }, [api]);

  useEffect(() => {
    void carregarLista();
  }, [carregarLista]);

  const abrir = useCallback(
    async (id: string) => {
      setAberta(id);
      setRascunho('');
      setErro('');
      setMensagens([]);
      try {
        const data = await api(`/conversations/${id}`);
        setDetalhe(data?.conversation || null);
        setMensagens(data?.messages || []);
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível abrir a conversa.');
      }
    },
    [api],
  );

  const responder = useCallback(async () => {
    const texto = rascunho.trim();
    if (!texto || !aberta) return;
    setAEnviar(true);
    setErro('');
    try {
      await api(`/conversations/${aberta}/reply`, { method: 'POST', body: { body: texto } });
      setRascunho('');
      // Recarrega as duas: a resposta muda o estado da conversa e a ordem da lista.
      await Promise.all([abrir(aberta), carregarLista()]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A resposta não saiu.');
    } finally {
      setAEnviar(false);
    }
  }, [api, aberta, rascunho, abrir, carregarLista]);

  const marcar = useCallback(
    async (state: ConversationState) => {
      if (!aberta) return;
      setErro('');
      try {
        await api(`/conversations/${aberta}`, { method: 'PATCH', body: { state } });
        await Promise.all([abrir(aberta), carregarLista()]);
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Não foi possível mudar o estado.');
      }
    },
    [api, aberta, abrir, carregarLista],
  );

  if (aCarregar) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Caixa de Entrada"
        sub="Mensagens de doentes por SMS e chamadas transcritas. O que está escalado aparece primeiro."
      />

      {erro && (
        <div
          style={{
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-control)',
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {erro}
        </div>
      )}

      {rows.length === 0 ? (
        <Empty message="Nenhuma conversa ainda. Quando um doente enviar uma SMS ou deixar uma chamada, aparece aqui — é preciso ter um número configurado." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,340px) minmax(0,1fr)', gap: 16 }}>
          {/* ── Lista ── */}
          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-card)',
              background: 'var(--bg-surface)',
              overflow: 'hidden',
              alignSelf: 'start',
              maxHeight: '72vh',
              overflowY: 'auto',
            }}
          >
            {rows.map((c) => {
              const tom = STATE_TONE[c.state];
              const ativa = c.id === aberta;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => abrir(c.id)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '11px 13px',
                    border: 'none',
                    borderBottom: '1px solid var(--border-subtle)',
                    borderLeft: `3px solid ${tom ? tom.color : 'transparent'}`,
                    background: ativa ? 'var(--bg-sunken)' : 'transparent',
                    cursor: 'pointer',
                    font: 'inherit',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {c.patient_name || c.from_addr || 'Contacto não identificado'}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                      {quando(c.last_message_at)}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-muted)',
                      marginTop: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.last_body || '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {tom && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 'var(--radius-pill)',
                          background: tom.bg,
                          color: tom.color,
                        }}
                      >
                        {CONVERSATION_STATE_LABELS[c.state]}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{CHANNEL_LABELS[c.channel]}</span>
                    {c.last_intent && INTENT_LABELS[c.last_intent as keyof typeof INTENT_LABELS] && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        · {INTENT_LABELS[c.last_intent as keyof typeof INTENT_LABELS]}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* ── Conversa ── */}
          <div
            style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-card)',
              background: 'var(--bg-surface)',
              padding: 16,
              minHeight: 300,
            }}
          >
            {!aberta ? (
              <Empty message="Escolhe uma conversa. A lista à esquerda está ordenada pelo que precisa de ti." />
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                    flexWrap: 'wrap',
                    paddingBottom: 10,
                    borderBottom: '1px solid var(--border-subtle)',
                    marginBottom: 12,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {detalhe?.patient_name || detalhe?.from_addr || 'Contacto não identificado'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {detalhe ? CHANNEL_LABELS[detalhe.channel] : ''}
                      {detalhe?.state ? ` · ${CONVERSATION_STATE_LABELS[detalhe.state]}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {detalhe?.state !== 'resolved' && (
                      <button
                        type="button"
                        onClick={() => marcar('resolved')}
                        style={{
                          fontSize: 12,
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-control)',
                          border: '1px solid var(--border-subtle)',
                          background: 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        Marcar resolvida
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  {mensagens.map((m) => {
                    const doDoente = m.direction === 'inbound';
                    return (
                      <div
                        key={m.id}
                        style={{
                          alignSelf: doDoente ? 'flex-start' : 'flex-end',
                          maxWidth: '78%',
                          background: doDoente ? 'var(--bg-sunken)' : 'var(--accent-bg)',
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-card)',
                        }}
                      >
                        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{m.body}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                          {quemFala(m)} · {quando(m.created_at)}
                          {m.intent && INTENT_LABELS[m.intent as keyof typeof INTENT_LABELS]
                            ? ` · ${INTENT_LABELS[m.intent as keyof typeof INTENT_LABELS]}`
                            : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Uma chamada não se responde por escrito: o canal de voz nunca recebe
                    resposta automática nem manual daqui — devolve-se a chamada. */}
                {detalhe?.channel === 'voice' ? (
                  <Badge
                    label="Uma chamada devolve-se por telefone, não por mensagem"
                    bg="var(--bg-sunken)"
                    color="var(--text-secondary)"
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <Textarea
                      value={rascunho}
                      onChange={(e) => setRascunho(e.target.value)}
                      placeholder="Escrever resposta…"
                      rows={3}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Sai como SMS assinada pela clínica. Máximo 4000 caracteres.
                      </span>
                      <PrimaryBtn onClick={responder} disabled={aEnviar || !rascunho.trim()}>
                        {aEnviar ? 'A enviar…' : 'Responder'}
                      </PrimaryBtn>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
