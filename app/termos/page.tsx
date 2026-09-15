// Destino do link «Termos» no rodapé do ecrã de entrada, que era um 404.
//
// Como em /privacidade: o que aqui está descreve o comportamento real do sistema
// (papéis e permissões, registo de auditoria, cópias de segurança, limites de
// utilização). As cláusulas que são um compromisso comercial — preço, vigência, níveis
// de serviço, foro — dependem do contrato de cada instalação e ficam assinaladas em
// vez de inventadas. Um SLA escrito à toa numa página pública é uma promessa a sério.
import type { Metadata } from 'next';
import { PorPreencher, PublicPage, PublicSection } from '@/components/PublicPage';

export const metadata: Metadata = {
  title: 'Termos · Portucale',
  description: 'Condições de utilização do Portucale.',
};

export default function Termos() {
  return (
    <PublicPage
      title="Termos de utilização"
      intro="Estas condições regem o acesso ao Portucale pelo pessoal das clínicas que o utilizam. Não substituem o contrato celebrado entre a clínica e a operadora do serviço."
      updated="15 de setembro de 2026"
    >
      <PublicSection heading="O que é este serviço">
        <p style={{ margin: '0 0 12px' }}>
          O Portucale é uma camada de operação e receita para clínicas dentárias: agenda, lista de espera, recuperação
          de receita, inventário, tarefas e relatórios. Ajuda a decidir o que fazer a seguir.
        </p>
        <p style={{ margin: 0 }}>
          <strong>Não é um sistema de decisão clínica.</strong> Não emite diagnósticos nem recomenda tratamentos, e
          nenhuma das suas sugestões — risco de falta, próxima ação, ordenação de agenda — dispensa o juízo do
          profissional de saúde.
        </p>
      </PublicSection>

      <PublicSection heading="Contas e responsabilidade">
        <p style={{ margin: '0 0 12px' }}>
          As contas são nominais e criadas pela clínica. Não podem ser partilhadas: o registo de auditoria atribui cada
          acesso a uma pessoa, e uma conta partilhada torna esse registo inútil precisamente quando é preciso.
        </p>
        <p style={{ margin: 0 }}>
          Cada utilizador é responsável por manter a sua palavra-passe secreta e por comunicar de imediato à clínica
          qualquer suspeita de acesso indevido.
        </p>
      </PublicSection>

      <PublicSection heading="Papéis e limites de acesso">
        <p style={{ margin: 0 }}>
          O que cada pessoa vê e pode fazer depende do seu papel. Os limites são aplicados no servidor, e não apenas
          escondendo botões: um pedido feito fora do papel é recusado e o facto fica registado. Tentar contornar estes
          limites é fundamento para suspensão do acesso.
        </p>
      </PublicSection>

      <PublicSection heading="Dados dos doentes">
        <p style={{ margin: '0 0 12px' }}>
          Os dados pertencem à clínica e aos seus doentes. Quem utiliza o Portucale compromete-se a só consultar
          registos de que precisa para o seu trabalho.
        </p>
        <p style={{ margin: 0 }}>
          O tratamento de dados pessoais é descrito na{' '}
          <a href="/privacidade" style={{ color: 'var(--accent)' }}>
            política de privacidade
          </a>
          .
        </p>
      </PublicSection>

      <PublicSection heading="Disponibilidade e cópias de segurança">
        <p style={{ margin: '0 0 12px' }}>
          O serviço faz cópias de segurança automáticas, verificadas depois de criadas — uma cópia que não se consiga
          ler é assinalada como inválida em vez de ficar a contar como boa.
        </p>
        <PorPreencher>
          <strong>Por preencher pela operadora:</strong> frequência das cópias, prazo de retenção, objetivos de
          recuperação (RPO/RTO) e o nível de disponibilidade contratado. Sem isto, esta secção descreve um mecanismo mas
          não constitui compromisso.
        </PorPreencher>
      </PublicSection>

      <PublicSection heading="Utilização aceitável">
        <p style={{ margin: 0 }}>
          Não é permitido tentar aceder a dados de outra clínica, sondar ou contornar os mecanismos de segurança,
          automatizar pedidos para lá dos limites do serviço, nem extrair dados em massa para fins alheios à operação da
          clínica.
        </p>
      </PublicSection>

      <PublicSection heading="Suspensão">
        <p style={{ margin: 0 }}>
          O acesso de um utilizador pode ser suspenso de imediato em caso de violação destas condições ou de risco para
          os dados dos doentes. A suspensão de uma conta produz efeito em todas as sessões abertas.
        </p>
      </PublicSection>

      <PublicSection heading="Condições comerciais">
        <PorPreencher>
          <strong>Por preencher pela operadora:</strong> preço e forma de pagamento, vigência e renovação, denúncia,
          devolução ou exportação dos dados no fim do contrato, limitação de responsabilidade e lei e foro aplicáveis.
          Estas matérias constam do contrato celebrado com a clínica e não são definidas por esta página.
        </PorPreencher>
      </PublicSection>
    </PublicPage>
  );
}
