'use client';
import AuditLog from '@/components/shared/AuditLog';
import AuditFeed from '@/components/super-admin/AuditFeed';
import { PageHeader, Tabs } from '@/components/ui';
import { useTabHash } from '@/hooks/useTabHash';

// ─── Quatro entradas de menu, uma tabela ────────────────────────────────────
// «Registo de Auditoria», «Registos de Acesso», «Eventos de Sistema» e «Eventos de
// Segurança» eram quatro entradas no menu da plataforma. Liam as quatro o mesmo
// `audit_log`, pela mesma rota (/api/audit), e o que as distinguia era o conjunto de
// ações que cada uma deixava passar. Um conjunto de ações é um filtro, não um destino —
// e quatro destinos para o mesmo sítio ensinam a quem usa que há quatro coisas quando
// há uma.
//
// «Eventos de Sistema» não sobreviveu sequer como separador: era o audit_log inteiro e
// sem recorte, que é precisamente o que «Tudo» mostra. O que dele se guardou foi a nota
// sobre a cadeia de hashes — a única coisa que aquela página dizia e que nenhuma outra
// diz.
//
// Os dois recortes que ficaram são separadores e não filtros na barra porque nomeiam
// uma pergunta («quem entrou?», «o que foi negado?») que não se lê de uma lista de
// ações. O filtro por ação continua lá dentro, no separador «Tudo», para o resto.
const ACESSOS = ['AUTH', 'AUTH_FAIL'];
const SEGURANCA = ['AUTH_FAIL', 'FORBIDDEN', 'RATE_LIMIT', 'DELETE'];

const TABS = [
  { key: 'tudo', label: 'Tudo' },
  { key: 'acessos', label: 'Acessos' },
  { key: 'seguranca', label: 'Segurança' },
];

const CHAVES = TABS.map((t) => t.key);

// Cada recorte diz o que fica de fora dele. São as notas de rodapé que as três páginas
// tinham, e valem mais do que o ecrã que as continha: nomeiam o ficheiro que escreve
// cada linha, que é por onde se começa quando um registo não aparece.
const NOTAS: Record<string, string> = {
  tudo: 'É o audit_log inteiro e sem recorte. As linhas são encadeadas por hash (ver o trigger em scripts/schema.sql): uma linha alterada à mão quebra a cadeia da seguinte.',
  acessos:
    'Cada entrada e cada tentativa falhada é escrita por app/api/auth/login/route.ts. O que NÃO está aqui é o IP de origem: só é registado na linha de RATE_LIMIT, e passá-lo a todas as linhas de autenticação é uma alteração a lib/audit.ts.',
  seguranca:
    'FORBIDDEN vem de logBlockedAccess (lib/audit.ts), que é chamado sempre que alguém tenta uma ação acima do seu papel — incluindo as leituras de plataforma. DELETE está aqui de propósito: é a ação irreversível.',
};

export default function Auditoria() {
  const [tab, setTab] = useTabHash(CHAVES, 'tudo');

  return (
    <div>
      <PageHeader title="Auditoria" sub="Registo de atividade de todas as clínicas — imutável, com hash SHA-256" />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'tudo' && <AuditLog scope="platform" />}
      {tab === 'acessos' && <AuditFeed actions={ACESSOS} emptyMessage="Sem entradas registadas" />}
      {tab === 'seguranca' && <AuditFeed actions={SEGURANCA} emptyMessage="Nenhum evento de segurança" />}

      <p
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-secondary)',
          lineHeight: 'var(--text-xs-leading)',
          marginTop: 16,
        }}
      >
        {NOTAS[tab]}
      </p>
    </div>
  );
}
