'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import JourneyBoard from '@/components/patient/JourneyBoard';
import { Empty, GhostBtn, PanelBar, PanelNote, Spinner } from '@/components/ui';
import type { Lead, LifecycleData } from '@/lib/types';

export default function JornadaPanel() {
  const { api } = useAuth();
  const [data, setData] = useState<LifecycleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr('');
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

  async function updateLeadStatus(lead: Lead, status: 'converted' | 'lost') {
    setBusyId(lead.id);
    setErr('');
    try {
      await api('/leads', { method: 'PATCH', body: { id: lead.id, status } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Não foi possível mudar o estado do contacto.');
    }
    setBusyId(null);
    load();
  }

  return (
    <div>
      <PanelBar>
        <GhostBtn onClick={load}>Atualizar</GhostBtn>
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

      {loading ? (
        <Spinner />
      ) : !data ? (
        <Empty message="Sem dados disponíveis." />
      ) : (
        <JourneyBoard
          data={data}
          leadActions={(lead) => (
            <div className="flex gap-1.5 mt-2">
              <GhostBtn
                disabled={busyId === lead.id}
                onClick={() => updateLeadStatus(lead, 'converted')}
                style={{ padding: '4px 8px', fontSize: 'var(--text-2xs)' }}
              >
                {busyId === lead.id ? '…' : 'Marcação feita'}
              </GhostBtn>
              <GhostBtn
                disabled={busyId === lead.id}
                onClick={() => updateLeadStatus(lead, 'lost')}
                style={{ padding: '4px 8px', fontSize: 'var(--text-2xs)' }}
              >
                Fechar
              </GhostBtn>
            </div>
          )}
        />
      )}
    </div>
  );
}
