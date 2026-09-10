'use client';
import NotInstrumented from '@/components/super-admin/NotInstrumented';

export default function SecuritySessions() {
  return (
    <NotInstrumented
      title="Sessões"
      sub="Sessões ativas"
      purpose={'Quem está com sessão iniciada, desde quando e de onde — e o botão para terminar uma sessão à força.'}
      needs={[
        'Um registo de sessões do lado do servidor: a autenticação é por JWT assinado (lib/jwt-edge.ts), que por desenho não guarda estado nenhum',
        'Um mecanismo de revogação por sessão',
      ]}
      note={
        'Já existe metade da revogação, e é a metade difícil: `users.password_changed_at` (migração 046) invalida todos os tokens anteriores à mudança de senha, e lib/permissions.ts revalida cada sessão contra a tabela `users` a cada pedido. O que falta é a LISTA — saber quantas sessões existem, não conseguir cortá-las.'
      }
    />
  );
}
