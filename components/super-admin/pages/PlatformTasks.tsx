'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function PlatformTasks() {
  return (
    <NotInstrumented
      title="Tarefas da Plataforma"
      sub="Trabalho interno da Portucale"
      purpose={
        'A fila de trabalho da equipa interna: provisionar uma clínica, migrar dados, investigar uma falha. Distinta das tarefas clínicas, que pertencem a cada clínica e já existem em `patient_tasks`.'
      }
      needs={[
        'Uma fila de tarefas ao nível da plataforma, com dono e estado',
        'Ligação às origens que geram trabalho: uma clínica em onboarding parada, uma falha de agente repetida',
      ]}
      note={
        'As tarefas que existem hoje (`patient_tasks`) são sempre de uma clínica e sobre um doente — não servem para isto, e alargá-las serviria mal aos dois casos.'
      }
    />
  );
}
