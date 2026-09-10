'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ApiOptions } from '@/app/providers';
import { Badge, DangerBtn, DataTable, Empty, GhostBtn, PageHeader, Sel, Spinner, TD } from '@/components/ui';
import type { PatientTask, PatientTaskType } from '@/lib/types';

interface TasksQueueViewProps {
  // biome-ignore lint/suspicious/noExplicitAny: generic fetch wrapper — response shape varies per endpoint
  api: (path: string, opts?: ApiOptions) => Promise<any>;
  currentUserId?: string;
}

const TYPE_LABELS: Record<PatientTaskType, string> = {
  generic: 'Geral',
  call: 'Ligar',
  document_request: 'Pedido de documento',
  follow_up: 'Follow-up',
  data_missing: 'Dados em falta',
};

export default function TasksQueueView({ api, currentUserId }: TasksQueueViewProps) {
  const [tasks, setTasks] = useState<PatientTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [typeFilter, setTypeFilter] = useState<PatientTaskType | 'all'>('all');
  const [assigning, setAssigning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await api('/patient-tasks?status=pending').catch(() => []);
    setTasks(rows || []);
    setLoading(false);
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, patch: { complete?: boolean; cancel?: boolean }) {
    const row = await api(`/patient-tasks/${id}`, { method: 'PUT', body: patch }).catch(() => null);
    if (row) setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  // Item 11 — "distribuição de tarefas", manualmente accionada. O mesmo router que
  // os jobs usam (lib/taskRouting.ts): quem está de turno, do papel certo, com
  // menos tarefas abertas. A tarefa continua na lista, agora com dono.
  async function autoAssign(id: string) {
    setAssigning(id);
    const row = await api(`/patient-tasks/${id}`, { method: 'PUT', body: { autoAssign: true } }).catch(() => null);
    setAssigning(null);
    if (row) setTasks((prev) => prev.map((t) => (t.id === id ? row : t)));
  }

  const visible = tasks.filter((t) => {
    if (scope === 'mine' && t.assigned_to !== currentUserId) return false;
    if (scope === 'unassigned' && t.assigned_to) return false;
    if (typeFilter !== 'all' && t.type !== typeFilter) return false;
    return true;
  });

  const now = Date.now();

  return (
    <div>
      <PageHeader title="Tarefas" sub="Fila de tarefas e lembretes ligados a pacientes" />
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <Sel value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} style={{ width: 200 }}>
          <option value="all">Todas</option>
          <option value="mine">Atribuídas a mim</option>
          <option value="unassigned">Fila da equipa</option>
        </Sel>
        <Sel
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          style={{ width: 200 }}
        >
          <option value="all">Todos os tipos</option>
          {Object.entries(TYPE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Sel>
      </div>

      {loading ? (
        <Spinner />
      ) : !visible.length ? (
        <Empty message="Sem tarefas em aberto." />
      ) : (
        <DataTable
          cols={['Título', 'Paciente', 'Tipo', 'Prazo', 'Atribuído', '']}
          rows={visible.map((t) => {
            const overdue = !!t.due_at && new Date(t.due_at).getTime() < now;
            return (
              <tr key={t.id}>
                <TD bold>{t.title}</TD>
                <TD>{t.patient_name || '—'}</TD>
                <TD>{TYPE_LABELS[t.type]}</TD>
                <TD color={overdue ? 'var(--urgency-critical)' : undefined}>
                  {t.due_at ? new Date(t.due_at).toLocaleDateString('pt-PT') : '—'}
                </TD>
                <TD>
                  {t.assigned_to_name ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {t.assigned_to_name}
                      {t.auto_assigned && <Badge label="auto" bg="var(--accent-bg)" color="var(--accent)" />}
                    </span>
                  ) : (
                    'Fila da equipa'
                  )}
                </TD>
                <TD right>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {!t.assigned_to && (
                      <GhostBtn
                        onClick={() => autoAssign(t.id)}
                        disabled={assigning === t.id}
                        style={{ padding: '5px 10px', fontSize: 12 }}
                      >
                        {assigning === t.id ? 'A atribuir…' : 'Atribuir automaticamente'}
                      </GhostBtn>
                    )}
                    <GhostBtn
                      onClick={() => setStatus(t.id, { complete: true })}
                      style={{ padding: '5px 10px', fontSize: 12 }}
                    >
                      Concluir
                    </GhostBtn>
                    <DangerBtn
                      onClick={() => setStatus(t.id, { cancel: true })}
                      style={{ padding: '5px 10px', fontSize: 12 }}
                    >
                      Cancelar
                    </DangerBtn>
                  </div>
                </TD>
              </tr>
            );
          })}
        />
      )}
    </div>
  );
}
