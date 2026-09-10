'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/app/providers';
import JourneyBoard from '@/components/patient/JourneyBoard';
import { Empty, GhostBtn, PageHeader, Spinner } from '@/components/ui';
import type { LifecycleData } from '@/lib/types';

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
      <PageHeader
        title="Jornada do Paciente"
        sub="Lead → Marcação → Consulta → Plano → Tratamento → Conclusão → Recall — o que deve acontecer agora, por paciente"
      >
        <GhostBtn onClick={load} style={{ padding: '8px 12px' }}>
          Atualizar
        </GhostBtn>
      </PageHeader>

      {err && (
        <div
          className="card p-4 mb-4"
          style={{
            border: '1px solid var(--urgency-critical-border)',
            background: 'var(--urgency-critical-bg)',
            color: 'var(--urgency-critical)',
            fontWeight: 700,
          }}
        >
          {err}
        </div>
      )}

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
