FROM node:22-alpine AS base
# tzdata na base, e não só na imagem final: os serviços `migrate`, `jobs` e
# `watchdog` do docker-compose.yml correm a stage `builder`, e é o `jobs` que decide
# turnos, passagens de turno e a que horas saem os lembretes. Sem este pacote o
# Alpine não conhece "Europe/Lisbon" e qualquer TZ nomeado cai em silêncio para UTC —
# a variável fica posta e não muda nada, que é a pior das duas maneiras de falhar.
RUN apk add --no-cache tzdata
ENV TZ=Europe/Lisbon

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# next.config.mjs's headers() — and therefore the Content-Security-Policy — is
# evaluated HERE, at build time, and baked into .next: a value supplied only through
# the runtime `environment:` block never reaches it (verified: starting the built
# image with R2_ENDPOINT set produces a CSP without it). The CSP names the R2 origin
# in img-src/connect-src, so without these build args a deployment that uses R2 would
# ship a policy that blocks its own uploads and stored images. Empty defaults keep
# builds that don't use R2 working unchanged — they just get a tighter policy.
# Not secrets: both are public origins, unlike the R2 keys, which stay runtime-only.
ARG R2_ENDPOINT=""
ARG R2_PUBLIC_BASE_URL=""
ENV R2_ENDPOINT=$R2_ENDPOINT
ENV R2_PUBLIC_BASE_URL=$R2_PUBLIC_BASE_URL

RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# O mesmo fuso que o docker-compose.yml passa, aqui como omissão para quem corre a
# imagem sem o compose. As datas de consulta são hora de parede de Lisboa e há código
# que as compara com getHours()/getDay() locais — em UTC ficam deslocadas uma hora
# durante a hora de verão. `tzdata` é preciso para o Alpine saber o que é "Lisboa".
ENV TZ=Europe/Lisbon

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.mjs ./

# ─── O diretório dos uploads existe na IMAGEM, de propósito ─────────────────
# lib/uploads.ts grava em `process.cwd()/public/uploads` quando o R2 não está
# configurado, criando o diretório com mkdir à primeira gravação. Isso bastava
# enquanto ninguém montava nada lá — mas o docker-compose.yml passou a montar um
# volume nomeado neste caminho (sem ele, cada redeploy levava consigo os anexos
# das notas clínicas e os ficheiros que os doentes submetem pelo portal).
#
# E um volume nomeado sobre um caminho que NÃO existe na imagem nasce root:root,
# o que deixaria o utilizador `nextjs` sem escrita — uploads a falhar com EACCES
# em produção e em lado nenhum mais. Criado aqui, o Docker copia dono e permissões
# deste diretório para o volume na primeira montagem, e o chown abaixo cobre-o.
RUN mkdir -p ./public/uploads

RUN chown -R nextjs:nodejs /app

USER nextjs

# ─── Que commit é este ──────────────────────────────────────────────────────
# lib/platformStats.ts lê BUILD_COMMIT e mostra-o em Definições › Configuração.
# Sem nada a injetá-lo, o campo respondia sempre null e a página dizia «não
# definido» — verdade, mas inútil: a pergunta a que aquele ecrã existe para
# responder é «o que é que está em produção AGORA», e sem o commit ela não tem
# resposta.
#
# Runtime e não build: é lido a cada pedido, por isso tem de estar no ENV desta
# imagem, e não na que a construiu. Fica aqui no fim de propósito — um commit
# novo a cada build invalidaria tudo o que viesse a seguir, e a seguir não vem
# nada. As camadas de npm ci e de build não dão por isto.
#
# Vazio por omissão para que um `docker build` sem argumento nenhum continue a
# funcionar. Passa-se assim:
#   docker build --build-arg BUILD_COMMIT=$(git rev-parse --short HEAD) .
ARG BUILD_COMMIT=""
ENV BUILD_COMMIT=$BUILD_COMMIT

EXPOSE 3000
CMD ["npm", "start"]
