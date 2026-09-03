FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

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

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./
COPY --from=builder /app/next.config.mjs ./

RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000
CMD ["npm", "start"]
