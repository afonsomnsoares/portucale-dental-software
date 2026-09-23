'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import JourneyBoard from '@/components/patient/JourneyBoard';
import { Empty, FormField, GhostBtn, Inp, PanelBar, PanelNote, PrimaryBtn, Spinner } from '@/components/ui';
import type { LifecycleData } from '@/lib/types';

// ─── Quando é que um doente conta como desaparecido ─────────────────────────
// Estava escrito no código, a seis meses, e era o mesmo número para toda a gente. Numa
// clínica de higiene e manutenção, seis meses sem aparecer é o ciclo normal e ninguém
// desapareceu; numa de ortodontia, dois meses de silêncio já é um doente perdido — ver o
// cabeçalho da migração 060. Só aparece a quem tem 'lifecycle:configure' (a direção):
// mudar isto reclassifica a base de doentes inteira e decide quem entra em reativação.
function LimiarInatividade({ onSaved }: { onSaved: () => void }) {
  const { api, user } = useAuth();
  const [meses, setMeses] = useState<string>('');
  const [limites, setLimites] = useState<{ min: number; max: number; defaultMonths: number } | null>(null);
  const [gravando, setGravando] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');

  useEffect(() => {
    api('/lifecycle/settings')
      .then((r: { inactiveMonths: number; min: number; max: number; defaultMonths: number }) => {
        setMeses(String(r.inactiveMonths));
        setLimites({ min: r.min, max: r.max, defaultMonths: r.defaultMonths });
      })
      .catch(() => setLimites(null));
  }, [api]);

  if (!user?.permissions?.includes('lifecycle:configure') || !limites) return null;

  const gravar = async () => {
    setErro('');
    setMsg('');
    setGravando(true);
    try {
      await api('/lifecycle/settings', { method: 'PUT', body: JSON.stringify({ inactiveMonths: Number(meses) }) });
      setMsg('Guardado. A reclassificação aparece na próxima leitura.');
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao guardar');
    } finally {
      setGravando(false);
    }
  };

  return (
    <div className="card p-4 mb-4">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <FormField
          label="Considerar desaparecido após"
          hint={`Entre ${limites.min} e ${limites.max} meses sem visita nem nada agendado. Por omissão: ${limites.defaultMonths}.`}
        >
          <Inp
            type="number"
            min={limites.min}
            max={limites.max}
            value={meses}
            onChange={(e) => setMeses(e.target.value)}
            style={{ width: 110 }}
          />
        </FormField>
        <PrimaryBtn onClick={gravar} disabled={gravando || meses === ''}>
          {gravando ? 'A guardar…' : 'Guardar'}
        </PrimaryBtn>
      </div>
      {/* Dito por extenso porque a consequência não é local: o mesmo número rege a coluna
          «Desaparecido» aqui e a categoria «Pacientes inativos» do ecrã de Recuperação. */}
      <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-muted)', marginTop: 8, maxWidth: '44rem' }}>
        Este número decide quem entra em campanha de reativação e move também a categoria «Pacientes inativos» em
        Recuperação. Baixá-lo alarga a lista; subi-lo esvazia-a.
      </p>
      {msg && <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--urgency-ok)', marginTop: 6 }}>{msg}</p>}
      {erro && <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--urgency-critical)', marginTop: 6 }}>{erro}</p>}
    </div>
  );
}

// Jornada do paciente da própria clínica. Ao contrário da versão de plataforma
// (components/super-admin/pages/Lifecycle.tsx), não há seletor de clínica: para quem não é
// super_admin, app/api/lifecycle/route.ts ignora ?tenantId= e usa sempre user.tenantId.
export default function ClinicLifecyclePage() {
  const { api } = useAuth();
  const [data, setData] = useState<LifecycleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    const res = await api('/lifecycle').catch((e) => {
      setErr(e instanceof Error ? e.message : 'Falha ao carregar');
      return null;
    });
    setData(res);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PanelBar>
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PanelBar>

      <PanelNote>
        Lead → Marcação → Consulta → Plano → Tratamento → Conclusão → Recall — o que deve acontecer agora, por paciente.
      </PanelNote>

      {err && (
        <div
          className="card p-4 mb-4"
          style={{
            border: '1px solid var(--urgency-critical-border)',
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            fontWeight: 'var(--weight-bold)',
          }}
        >
          {err}
        </div>
      )}

      <LimiarInatividade onSaved={load} />

      {loading ? (
        <div className="card p-5">
          <Spinner />
        </div>
      ) : !data ? (
        <Empty message="Sem dados disponíveis." />
      ) : (
        <JourneyBoard data={data} />
      )}
    </div>
  );
}
