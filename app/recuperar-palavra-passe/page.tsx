// Destino do «Recuperar acesso» no ecrã de entrada (app/page.tsx). Era um link para
// um caminho que não existia — e quem clica nele é, por definição, quem está trancado
// fora da conta.
//
// ─── Porque é que esta página explica em vez de repor ───────────────────────
// Neste produto as contas não se registam sozinhas: são criadas por um admin da
// clínica em /dashboard/*/equipa (POST /api/users), e é o mesmo admin que muda uma
// password (PUT /api/users/[id]). Não há auto-serviço, e portanto o caminho de
// recuperação verdadeiro é falar com quem administra a clínica — que é o que aqui se
// diz.
//
// Uma reposição por token seria uma funcionalidade nova, não uma correção: obrigava a
// decidir canal de entrega, validade do token, limites de tentativas e o que fazer
// quando o endereço de e-mail já não é da pessoa. Fica por decidir, de propósito.
import type { Metadata } from 'next';
import { PublicPage, PublicSection } from '@/components/PublicPage';

export const metadata: Metadata = {
  title: 'Recuperar acesso · Portucale',
  description: 'Como voltar a entrar quando perdeu a palavra-passe.',
};

export default function RecuperarPalavraPasse() {
  return (
    <PublicPage
      title="Recuperar acesso"
      intro="As contas do Portucale são criadas e geridas pela sua clínica. Por isso a reposição da palavra-passe faz-se por lá — e não por um e-mail automático."
    >
      <PublicSection heading="Se é rececionista, dentista ou assistente">
        <p style={{ margin: '0 0 12px' }}>
          Peça a um <strong>administrador da sua clínica</strong> para lhe definir uma palavra-passe nova. Ele faz isso
          em <strong>Equipa → o seu nome → Alterar palavra-passe</strong>, e a nova fica ativa de imediato.
        </p>
        <p style={{ margin: 0 }}>
          Assim que a palavra-passe muda, todas as sessões antigas deixam de valer — incluindo qualquer uma que tenha
          ficado aberta noutro computador. Se suspeita que alguém entrou na sua conta, é esta a forma de fechar tudo.
        </p>
      </PublicSection>

      <PublicSection heading="Se é administrador da clínica">
        <p style={{ margin: '0 0 12px' }}>
          Um administrador pode repor a palavra-passe de qualquer pessoa da sua própria clínica, mas não a sua. Para a
          sua, é preciso o <strong>administrador da plataforma</strong>.
        </p>
        <p style={{ margin: 0 }}>Se é a única pessoa com acesso administrativo, use o contacto de suporte abaixo.</p>
      </PublicSection>

      <PublicSection heading="A conta está bloqueada em vez de esquecida?">
        <p style={{ margin: '0 0 12px' }}>
          Depois de várias tentativas falhadas seguidas, a entrada fica travada durante alguns minutos. Não é preciso
          fazer nada: <strong>espere e tente outra vez</strong>. A palavra-passe continua a mesma.
        </p>
        <p style={{ margin: 0 }}>
          Se a mensagem disser que a conta está desativada, foi mesmo desativada por um administrador — e só ele a pode
          reativar.
        </p>
      </PublicSection>

      <PublicSection heading="Contacto de suporte">
        <p style={{ margin: 0 }}>
          Para o que não se resolve dentro da clínica, fale com o suporte do Portucale pelo canal contratado com a sua
          organização.
        </p>
      </PublicSection>
    </PublicPage>
  );
}
