-- ─── Os ficheiros de doentes deixam de ser servidos por URL direto ────────────
--
-- `uploads.url` guardava o sítio onde o ficheiro está: `/uploads/<uuid>.<ext>` (o
-- diretório estático do Next, servido sem qualquer verificação) ou o URL público do
-- bucket R2. Em ambos os casos o controlo de acesso a raios-X, documentos de
-- identificação, cartões de seguro e consentimentos assinados era um só: o endereço
-- ser difícil de adivinhar.
--
-- Quem tivesse o endereço via o ficheiro — sem sessão, a partir de outra clínica,
-- depois de ter saído da empresa, e sem fim. O `expires_at` só era aplicado pelo job
-- noturno que apaga o ficheiro do disco, por isso entre a expiração e a passagem
-- seguinte do job continuava a ser servido na mesma.
--
-- A partir daqui o `url` aponta sempre para app/api/uploads/[id]/file, que confere
-- sessão, clínica e validade a cada pedido. `storage` e `storage_key` não mudam: são
-- eles que continuam a dizer onde o ficheiro está mesmo, e é a rota que os lê.
--
-- Esta migração trata das linhas que já existem. As novas já nascem assim
-- (lib/uploads.ts).

UPDATE uploads
   SET url = '/api/uploads/' || id || '/file'
 WHERE url IS DISTINCT FROM '/api/uploads/' || id || '/file';

-- ─── E os ficheiros que já estão no disco público? ────────────────────────────
-- Os ficheiros NOVOS passam a ser gravados em `data/uploads`, fora da árvore que o
-- Next serve estaticamente (UPLOADS_DIR em lib/uploads.ts). Os que já existem ficam
-- onde estão, em `public/uploads`, e continuam a ser lidos pela rota — que os procura
-- nos dois sítios (LEGACY_UPLOADS_DIR).
--
-- Não se movem daqui de propósito: mexer em ficheiros a partir de uma migração de
-- base de dados, com um volume do Docker montado por baixo e possivelmente dois
-- processos a correr, é como se perdem anexos clínicos. A retenção vai-os apagando
-- pelo caminho normal.
--
-- Fica um resto conhecido, e é este: enquanto houver ficheiros em `public/uploads`, um
-- endereço `/uploads/<uuid>.<ext>` que alguém tenha guardado ANTES desta mudança
-- continua a resolver, porque o Next serve esse diretório. Nada de novo passa a estar
-- exposto — nenhum endereço desses é emitido a partir de agora — mas os antigos só
-- deixam de valer quando o volume ficar vazio.
--
-- Para o fechar de vez, sem esperar pela retenção, basta mover os ficheiros uma vez,
-- com a aplicação parada:
--
--   docker compose stop app jobs
--   docker compose run --rm --entrypoint sh app -c 'mv /app/public/uploads/* /app/data/uploads/ 2>/dev/null; true'
--   docker compose start app jobs
--
-- Depois disso, o volume `uploads:` e o LEGACY_UPLOADS_DIR podem sair do projeto.
