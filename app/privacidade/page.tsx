// Destino do link «Privacidade» no rodapé do ecrã de entrada. Era um 404 — num
// produto que trata dados de saúde, que é a categoria mais sensível do RGPD.
//
// O que está escrito aqui descreve o que o software FAZ mesmo, verificável no código:
// isolamento por clínica em RLS (scripts/migrations/011), registo de acessos com
// cadeia de hash (015), políticas de retenção por categoria (lib/retention.ts) e os
// seis direitos do titular (lib/dataSubject.ts, data_subject_requests).
//
// O que NÃO está escrito é a identificação da entidade, a morada, o contacto do
// encarregado de proteção de dados e a lista de subcontratantes: isso depende de quem
// opera a instalação e é uma declaração jurídica, não uma propriedade do código.
// Aparece assinalado na página em vez de inventado.
import type { Metadata } from 'next';
import { PorPreencher, PublicPage, PublicSection } from '@/components/PublicPage';

export const metadata: Metadata = {
  title: 'Privacidade · Portucale',
  description: 'Como o Portucale trata dados pessoais e de saúde.',
};

export default function Privacidade() {
  return (
    <PublicPage
      title="Política de privacidade"
      intro="O Portucale é uma camada de operação para clínicas dentárias. Trata dados pessoais e dados de saúde por conta da clínica que o utiliza, e não por conta própria."
      updated="15 de setembro de 2026"
    >
      <PublicSection heading="Quem trata os dados, e a que título">
        <p style={{ margin: '0 0 12px' }}>
          A <strong>clínica</strong> é a responsável pelo tratamento: é ela que decide que doentes regista e para quê. O
          Portucale é <strong>subcontratante</strong> — trata os dados apenas segundo as instruções da clínica e para
          prestar o serviço.
        </p>
        <PorPreencher>
          <strong>Por preencher pela entidade que opera o serviço:</strong> denominação social, NIPC, morada, e o
          contacto do encarregado de proteção de dados (EPD/DPO). Enquanto estes elementos não forem indicados, esta
          página não cumpre o artigo 13.º do RGPD.
        </PorPreencher>
      </PublicSection>

      <PublicSection heading="Que dados são tratados">
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Identificação e contacto do doente</strong> — nome, telefone, e-mail, data de nascimento,
            preferências de contacto.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Dados de saúde</strong> — anamnese (alergias, medicação, condições), tratamentos, planos de
            tratamento, prescrições, pedidos de laboratório e consentimentos informados.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Dados operacionais</strong> — marcações, faltas, cancelamentos, faturação interna e mensagens
            enviadas.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Dados de utilização pelo pessoal da clínica</strong> — quem entrou, quando, e que registos consultou
            ou alterou.
          </li>
        </ul>
      </PublicSection>

      <PublicSection heading="Fora de âmbito, por decisão">
        <p style={{ margin: 0 }}>
          O Portucale <strong>não</strong> guarda imagens médicas nem faz imagiologia, não emite faturação certificada,
          não trata comparticipações ou reembolsos, e não produz qualquer decisão clínica. Essas matérias pertencem ao
          software clínico e de faturação da clínica.
        </p>
      </PublicSection>

      <PublicSection heading="Separação entre clínicas">
        <p style={{ margin: 0 }}>
          Cada clínica só vê os seus próprios dados. A separação não depende apenas do código da aplicação: está imposta
          na própria base de dados, por políticas de segurança ao nível da linha, de modo que uma consulta feita em nome
          de uma clínica não consegue devolver registos de outra.
        </p>
      </PublicSection>

      <PublicSection heading="Registo de acessos">
        <p style={{ margin: 0 }}>
          Os acessos e alterações a registos de doentes ficam gravados num registo de auditoria encadeado por hash —
          cada entrada é selada contra a anterior, o que torna detetável qualquer tentativa de apagar ou reescrever o
          histórico. O registo é apenas de escrita: nem a aplicação o pode alterar.
        </p>
      </PublicSection>

      <PublicSection heading="Durante quanto tempo">
        <p style={{ margin: '0 0 12px' }}>
          A clínica define prazos de conservação por categoria de dados, e o sistema aplica-os automaticamente. Passado
          o prazo, os dados dessa categoria são eliminados ou anonimizados conforme a política definida.
        </p>
        <PorPreencher>
          <strong>Por preencher:</strong> os prazos concretos praticados pela clínica, incluindo o prazo legal de
          conservação do processo clínico aplicável em Portugal.
        </PorPreencher>
      </PublicSection>

      <PublicSection heading="Direitos do titular">
        <p style={{ margin: '0 0 12px' }}>
          Qualquer doente pode exercer os direitos de <strong>acesso</strong>, <strong>retificação</strong>,{' '}
          <strong>apagamento</strong>, <strong>portabilidade</strong>, <strong>limitação</strong> e{' '}
          <strong>oposição</strong>. O pedido faz-se junto da clínica, que o regista no sistema e tem de lhe dar
          resposta.
        </p>
        <p style={{ margin: 0 }}>
          O apagamento exige confirmação explícita de quem o executa e fica ele próprio registado — não é possível dar
          um pedido por concluído sem que o trabalho tenha sido feito.
        </p>
      </PublicSection>

      <PublicSection heading="Subcontratantes">
        <p style={{ margin: '0 0 12px' }}>
          Consoante a configuração da instalação, podem ser usados serviços externos para armazenamento de ficheiros e
          envio de SMS.
        </p>
        <PorPreencher>
          <strong>Por preencher:</strong> a lista dos subcontratantes efetivamente utilizados nesta instalação, com a
          finalidade de cada um e o país de alojamento dos dados.
        </PorPreencher>
      </PublicSection>

      <PublicSection heading="Reclamações">
        <p style={{ margin: 0 }}>
          Sem prejuízo de contactar primeiro a clínica ou o encarregado de proteção de dados, qualquer titular pode
          apresentar reclamação à <strong>Comissão Nacional de Proteção de Dados (CNPD)</strong>.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
