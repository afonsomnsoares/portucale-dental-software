# Testes de integração

Testam as rotas de API (`app/api/**/route.ts`) contra uma base de dados PostgreSQL real,
separada da BD de desenvolvimento/produção — nunca usam mocks para a BD.

## Setup (uma vez)

1. Criar a base de dados de teste (reutiliza a instância Postgres já configurada em `.env`):
   ```
   createdb portucale_dental_test
   ```
2. Criar `.env.test` na raiz do projeto (git-ignorado — nunca commitar):
   ```
   DATABASE_URL=postgresql://<user>:<pass>@localhost:5432/portucale_dental_test
   JWT_SECRET=test-secret-do-not-use-in-prod
   NODE_ENV=test
   ```

## Correr a suite

```
node --import tsx --env-file=.env.test --test test/integration/
```

Na primeira execução, `test/helpers/testDb.ts` deteta que a BD de teste está vazia e
corre automaticamente `scripts/seed.ts --reset --with-demo-users` seguido de
`scripts/migrate.ts` (para replicar uma BD de produção real: schema base + todas as
migrações incrementais). Execuções seguintes reutilizam os mesmos dados — para forçar
um reset manual, `node --import tsx --env-file=.env.test scripts/seed.ts --reset --with-demo-users`.

`npm test` (sem `.env.test`) continua a correr só a suite unitária existente — os
testes desta pasta falham de propósito com um erro explícito ("DATABASE_URL not set")
nesse caso, em vez de tentar ligar a uma BD inexistente.

## Como funcionam, sem subir servidor

Cada teste importa o handler exportado da rota (`GET`/`POST`/`PUT`/`DELETE`) e invoca-o
diretamente com um `Request` construído por `test/helpers/authedRequest.ts` — não há
`next dev`/`next start` a correr. Isto significa que `proxy.ts` (guardas de rota,
rate limiting) nunca entra em jogo; cada rota faz a sua própria verificação de auth via
`getAuth()`, e é essa lógica que estes testes exercitam.

## Fixtures

Reutilizam os dados de demo de `scripts/seed.ts --with-demo-users` (tenant "Clínica
Portucale", utilizadores admin/receptionist/dentist, 5 pacientes) em vez de inventar
fixtures novas. Um segundo tenant ("Tenant B (testes)") é criado à parte por
`test/helpers/testDb.ts`, especificamente para os testes de isolamento entre clínicas.
