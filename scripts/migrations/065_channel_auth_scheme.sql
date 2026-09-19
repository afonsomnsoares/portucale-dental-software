-- ─── Como é que um webhook prova que é quem diz ser ──────────────────────────
-- `channel_accounts.secret_hash` existe desde a migração 049 e descreve UM esquema: um
-- segredo estático que o remetente põe num cabeçalho e que nós comparamos com o hash
-- guardado. Serve para um widget próprio ou um gateway self-hosted.
--
-- Não serve para a Twilio, que é o fornecedor que este projeto usa de facto. A Twilio
-- assina cada pedido com um HMAC-SHA1 sobre o URL e os parâmetros DESSE pedido — a
-- assinatura muda a cada mensagem e não há segredo estático nenhum para comparar. O
-- código anterior lia o `X-Twilio-Signature` e comparava-o como se fosse um segredo
-- fixo, o que dava 403 em todos os webhooks reais da Twilio enquanto parecia, a quem
-- lesse o ficheiro, que havia verificação de assinatura a acontecer.
--
-- Esta coluna torna o esquema explícito em vez de o deixar implícito no cabeçalho que
-- por acaso vier. Ver lib/inbound.ts (resolveChannelAccount) e lib/twilioSignature.ts.
--
--   'shared_secret'  — o que já existia: cabeçalho X-Portucale-Signature comparado
--                      contra secret_hash. Continua a ser o valor por omissão, por isso
--                      as contas que já existam não mudam de comportamento.
--   'twilio'         — assinatura real da Twilio, validada com TWILIO_AUTH_TOKEN (o
--                      mesmo que lib/sms.ts usa para enviar). Não usa secret_hash: o
--                      segredo é do ambiente, não da base de dados.
ALTER TABLE channel_accounts
  ADD COLUMN IF NOT EXISTS auth_scheme TEXT NOT NULL DEFAULT 'shared_secret';

ALTER TABLE channel_accounts DROP CONSTRAINT IF EXISTS channel_accounts_auth_scheme_check;
ALTER TABLE channel_accounts ADD CONSTRAINT channel_accounts_auth_scheme_check
  CHECK (auth_scheme IN ('shared_secret', 'twilio'));

-- ─── Uma conta sem forma de se autenticar é uma conta que não autentica ──────
-- O `resolveChannelAccount` recusa uma conta 'shared_secret' sem `secret_hash` — um
-- webhook que aceita qualquer coisa é pior do que um que não existe. A regra estava só
-- no código; aqui fica também na base, onde não depende de quem escreve o próximo
-- INSERT. 'twilio' não leva secret_hash de propósito: o segredo dela é o do ambiente.
--
-- NOT VALID, e é deliberado: o ADD CONSTRAINT normal valida as linhas que já existem e
-- falharia a migração inteira se alguma clínica tivesse uma conta antiga sem segredo.
-- Essa linha já não autentica nada (o resolveChannelAccount recusa-a desde a 049), por
-- isso o que interessa é impedir que nasça outra — e é exatamente isso que o NOT VALID
-- faz: vale para todos os INSERT e UPDATE daqui para a frente. Apagá-la aqui seria uma
-- migração de segurança a destruir configuração de uma clínica sem lhe perguntar.
ALTER TABLE channel_accounts DROP CONSTRAINT IF EXISTS channel_accounts_secret_presence;
ALTER TABLE channel_accounts ADD CONSTRAINT channel_accounts_secret_presence
  CHECK (auth_scheme <> 'shared_secret' OR secret_hash IS NOT NULL) NOT VALID;
