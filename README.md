# Portucale Dental

**Next.js 16 · React 19 · TypeScript · PostgreSQL 17 · App Router**

Plataforma SaaS multi-clínica para gestão de clínicas dentárias, desenhada para o mercado
português. Interface inteiramente em pt-PT.

---

## Sumário

O Portucale Dental é uma aplicação web full-stack que cobre o dia de uma clínica de ponta a
ponta: aquisição de doentes, agenda, ato clínico, faturação interna, operações da casa,
equipa, inventário e conformidade. Suporta várias clínicas num único deploy, com isolamento
reforçado em duas camadas (aplicação **e** Row-Level Security no PostgreSQL), quatro papéis
de utilizador com permissões granulares por clínica, e um conjunto de agentes que governam
o trabalho automático — sempre com fronteiras explícitas sobre o que uma máquina pode
decidir sozinha e o que exige uma pessoa.

Dimensão atual do código:

| | |
|---|---|
| Rotas de API | 106 |
| Páginas de dashboard | 65 |
| Tabelas PostgreSQL | 62 |
| Migrações incrementais | 43 |
| Testes unitários | 301 (26 ficheiros, sem base de dados) |
| Testes de integração | 124 (21 ficheiros, contra PostgreSQL real) |

---

## Arranque rápido

```bash
# 1. Base de dados (PostgreSQL 17 + pgAdmin)
export POSTGRES_APP_PASSWORD=$(openssl rand -base64 24)
export PGADMIN_PASSWORD=$(openssl rand -base64 24)
docker compose up -d postgres

# 2. Variáveis de ambiente
cp .env.example .env
#    preencher DATABASE_URL, APP_DATABASE_URL e JWT_SECRET (openssl rand -base64 48)

# 3. Schema + migrações + dados demo
npm install
npm run db:migrate
npm run db:seed -- --with-demo-users

# 4. Servidor
npm run dev            # http://localhost:3000
```

Em produção não se usa `--with-demo-users`: cria-se o super admin uma única vez com
`ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run create-admin`, e todos os
outros utilizadores nascem dentro do dashboard. Não existe ecrã de auto-registo.

### Credenciais demo

Criadas por `npm run db:seed -- --with-demo-users`. **Só para desenvolvimento — nunca em
produção.**

| Papel | Email | Password |
|-------|-------|----------|
| Super Admin | `admin@portucale.dental` | `admin123` |
| Rececionista | `rececao@portucale.dental` | `recep123` |
| Médico Dentista | `medico@portucale.dental` | `dent123` |

---

## Stack tecnológica

| Camada | Tecnologia | Versão | Função |
|--------|-----------|--------|--------|
| Framework | Next.js | ^16.2.3 | Full-stack (App Router) |
| UI | React | ^19.2.0 | Componentes |
| Linguagem | TypeScript | ^5.8.3 | Tipagem estática |
| Base de dados | PostgreSQL | 17 | BD principal, com RLS |
| Driver | pg | ^8.11.5 | Pool de ligações (sem ORM) |
| Estilo | Tailwind CSS | ^3.4.4 | CSS utility-first |
| Ícones | Lucide React | ^1.22.0 | Biblioteca de ícones |
| Voz | Web Speech API | Nativo | Ditado clínico (pt-PT) |
| Auth | JWT próprio + bcrypt | HMAC-SHA256 | Sessão em cookie + CSRF |
| IA | @anthropic-ai/sdk (Claude) | ^0.120.0 | Agentes |
| SMS | Twilio (API REST) | — | Lembretes e notificações |
| Ficheiros | Cloudflare R2 | S3-compatível | Uploads (fallback em disco local) |
| Lint/Format | Biome | ^2.5.0 | Lint + formatação |
| Git hooks | Husky + lint-staged | ^9.1.7 | Pre-commit |
| Testes | `node:test` | Nativo | Unitários + integração |
| Container | Docker Compose | Multi-stage | Produção |

Sem ORM, sem biblioteca de estado, sem framework de componentes: SQL escrito à mão em
`lib/*.ts`, React Context para a sessão, primitivas próprias em `components/ui.tsx`.

---

## Estrutura do projeto

```
portucale_dental/
├── scripts/
│   ├── schema.sql             ← Schema base PostgreSQL
│   ├── migrations/            ← 43 migrações incrementais (001 → 044)
│   ├── seed.ts                ← Dados demo (clínica, utilizadores, doentes, catálogos)
│   ├── migrate.ts             ← Runner de migrações (tabela schema_migrations)
│   ├── run-jobs.ts            ← Pipeline de jobs, para todas as clínicas ativas
│   ├── create-admin.ts        ← Criação única do super admin da plataforma
│   └── check-dburl.ts         ← Diagnóstico de DATABASE_URL
│
├── lib/                       ← Regra de negócio (56 módulos + 11 de agentes)
│   ├── db.ts                  ← Pool singleton, contexto de tenant para RLS
│   ├── auth.ts / jwt-edge.ts  ← JWT (Node e Edge), CSRF, sessão
│   ├── permissions.ts         ← ~65 ações, defaults por papel + override por clínica
│   ├── audit.ts               ← audit_log e patient_timeline (cadeia de hashes)
│   ├── tenantGuard.ts         ← Verificação de pertença à clínica
│   ├── rateLimit.ts           ← Limite genérico em memória (middleware Edge)
│   ├── rateLimitShared.ts     ← Limite de login partilhado, persistido em Postgres
│   ├── jobsRunner.ts          ← Pipeline de 24 jobs em segundo plano
│   ├── agents/                ← Catálogo de agentes + os que já usam IA
│   ├── *Calc.ts               ← Lógica pura, sem BD — é o que os testes unitários cobrem
│   └── types/                 ← Tipos partilhados por domínio
│
├── app/
│   ├── page.tsx               ← Login
│   ├── portal/[token]/        ← Portal do doente (sem sessão, token de uso único)
│   ├── api/                   ← 106 rotas
│   └── dashboard/
│       ├── super-admin/       ← Plataforma: clínicas, utilizadores, esquema
│       ├── admin/             ← Direção da clínica
│       ├── receptionist/      ← Receção
│       └── dentist/           ← Clínico
│
├── components/                ← 80 componentes (ui, clinic, super-admin, patient,
│                                 receptionist, dentist, inventory, operations, team…)
├── hooks/useSpeechRecognition.ts
├── test/                      ← 26 ficheiros unitários
│   └── integration/           ← 21 ficheiros contra PostgreSQL real
├── middleware.ts              ← Rate limit de /api/* + guards de rota por papel
└── docker-compose.yml         ← postgres, migrate, pgadmin, app, jobs
```

---

## Papéis e permissões

Quatro papéis, com árvores de dashboard separadas (`middleware.ts` → `DASHBOARD_ACCESS`):

| Papel | Âmbito | Acesso |
|-------|--------|--------|
| **Super Admin** | Plataforma (`tenant_id NULL`) | Clínicas, utilizadores, esquema, permissões e auditoria, através de todas as clínicas |
| **Admin** | Uma clínica | Tudo dentro da sua clínica: finanças, operações, equipa, inventário, permissões |
| **Rececionista** | Uma clínica | Doentes, leads, agenda, tratamentos, faturação, sala de espera, recalls, tarefas, documentos |
| **Dentista** | Uma clínica | Processo clínico, historial médico, prescrições, laboratório, planos, consentimentos, notas |

O que uma rota verifica não é o papel — é uma **ação** (`prescriptions:manage`,
`documents:generate`, `incidents:report`, …). Os defaults seguem o princípio do mínimo
privilégio: atos clínicos ficam com o dentista e a direção, trabalho administrativo é
partilhado com a receção. Cada clínica pode sobrepor qualquer combinação papel/ação em
`role_permissions`, pela UI de permissões — os defaults só valem onde não houver override.
Ver `lib/permissions.ts`.

---

## Segurança e isolamento entre clínicas

- **Sessão**: JWT próprio (HMAC-SHA256) em cookie `httpOnly`, com rotação de chaves —
  `JWT_SECRET` assina, `JWT_SECRETS` lista segredos antigos que ainda validam, para que
  uma rotação não expulse quem tem sessão aberta.
- **Passwords**: bcrypt. O login não distingue "email inexistente" de "password errada"
  (coberto por `test/integration/login-oracle.test.ts`).
- **CSRF**: double-submit cookie + verificação de origem em todas as mutações.
- **Rate limiting**: teto genérico sobre `/api/*` no middleware Edge (240 pedidos/min por
  utilizador autenticado, 60/min por IP anónimo), em memória e por instância. O limite do
  **login** é diferente: vive em `rate_limit_counters` no Postgres (`lib/rateLimitShared.ts`),
  porque é um controlo de segurança e não pode depender de qual réplica atendeu o pedido.
- **Isolamento multi-clínica em duas camadas independentes**: filtros `tenant_id` na
  aplicação **e** políticas de Row-Level Security no próprio PostgreSQL
  (`scripts/migrations/011_row_level_security.sql`), para que uma rota que se esqueça do
  filtro não chegue a ver linhas de outra clínica. Isto só funciona se a app ligar com
  `APP_DATABASE_URL` (papel `portucale_app`, não-superuser): um superuser ignora RLS
  incondicionalmente, e por isso `lib/db.ts` recusa arrancar sem essa variável quando
  `NODE_ENV=production`.
- **Cobertura de RLS testada**: `test/integration/rls-coverage.test.ts` falha se alguma
  tabela com `tenant_id` ficar sem política.
- **Auditoria à prova de adulteração**: `audit_log` e `patient_timeline` são append-only a
  nível de base de dados (`REVOKE UPDATE, DELETE`) e o hash de cada linha é calculado num
  trigger `BEFORE INSERT` que a encadeia à anterior — `sha256(prev_hash || campos)`.
  Alterar ou apagar uma linha parte a cadeia daí para a frente, de forma detetável
  (migração 015).
- **Rotas públicas**: existem exatamente duas rotas sem sessão, ambas autenticadas por
  bearer token em vez de cookie — captação externa de leads (`/api/public/leads`, a única
  com CORS aberto) e o portal do doente (`/api/public/patient-portal/[token]`).

---

## Modelo de dados

62 tabelas, definidas em `scripts/schema.sql` e evoluídas por 43 migrações aplicadas por
ordem de nome e registadas em `schema_migrations`.

| Domínio | Tabelas |
|---------|---------|
| Plataforma | `tenants`, `users`, `role_permissions`, `schema_fields`, `audit_log`, `job_runs`, `rate_limit_counters` |
| Doentes | `patients`, `patient_alerts`, `patient_timeline`, `medical_history`, `patient_interactions`, `patient_tasks`, `patient_lifecycle_state`, `patient_scheduling_prefs`, `patient_portal_tokens`, `uploads` |
| Agenda | `appointments`, `appointment_cancellations`, `statuses`, `waitlist_entries`, `slot_offers` |
| Clínico | `treatments`, `treatment_codes`, `treatment_plans`, `prescriptions`, `lab_orders`, `recalls`, `consent_forms` |
| Financeiro | `invoices`, `recovery_snapshots` |
| Aquisição | `leads`, `lead_capture_sources` |
| Operações | `checklist_templates`, `checklist_runs`, `incidents`, `shift_handoffs`, `staff_schedules`, `staff_time_off` |
| Inventário | `inventory_items`, `inventory_item_settings`, `inventory_stock`, `inventory_batches`, `inventory_movements`, `procedure_item_usage`, `suppliers`, `purchase_orders`, `purchase_order_items` |
| Equipamento | `clinic_equipment`, `equipment_maintenance` |
| Documentos | `document_templates`, `generated_documents` |
| Agentes | `agent_insights` |
| RGPD | `patient_data_consents`, `data_subject_requests`, `processing_activities`, `data_retention_policies`, `dpo_contacts`, `privacy_notices` |
| Comunicação | `notifications` |

**Catálogos por clínica.** `treatment_codes`, `statuses` e `inventory_item_settings` seguem
a mesma convenção: `tenant_id NULL` é o catálogo global instalado pelo seed, e uma linha com
`tenant_id` é o override dessa clínica. Cada clínica sobrepõe só o que quer mudar — não há
cópia por clínica do catálogo inteiro.

---

## Funcionalidades

### Doentes e processo clínico
- Registo de doentes com campos RGPD, alertas médicos e campos dinâmicos por clínica
- **Timeline imutável**: cada mutação relevante escreve uma linha encadeada por hash
- **Historial médico** (anamnese): alergias, medicação, condições, história familiar,
  tabagismo, gravidez
- **Notas clínicas com ditado por voz** (Web Speech API, pt-PT), com transcrição em tempo
  real, anexos e histórico
- **Prescrições**, **encomendas de laboratório**, **planos de tratamento** multi-fase com
  aprovação e assinatura, **consentimentos** por procedimento, **recalls** com intervalos
  configuráveis
- **Códigos TANOMD**: catálogo português de procedimentos (01 Consulta, 02 Preventiva,
  03 Dentisteria, 04 Endodontia, 05 Cirurgia Oral, 06 Periodontologia, 07 Implantologia,
  08 Prótese, 10 Radiologia), com preços por clínica
- **Próxima ação** por doente (`lib/nextAction.ts`): regras por ordem fixa de urgência —
  dados em falta, tarefas abertas, plano por aceitar, ausência de consulta futura
- **Briefing do dia** (`lib/dailyBriefing.ts`): os mesmos sinais, reduzidos a quem entra
  hoje pela porta

### Agenda
- Vista diária estilo Google Calendar (07:00–17:00), com blocos por cadeira, linha do
  "agora" e avanço de estado num clique
- **Máquina de estados** validada no servidor; transições inválidas devolvem HTTP 400:

  ```
  confirmed/registered → waiting → in-operatory → procedure-active → ready-dismissal → departed
                                                                                     ↘ no-show
  ```
- **Lista de espera**: inscrição com preferências (dentista, dias, janela horária, duração
  mínima). Quando uma consulta cai, o motor de matching (`lib/waitlistMatch.ts`) ordena os
  candidatos e oferece a vaga por SMS; as ofertas expiram em 24h, tratadas pelo pipeline
- **Preferências de agendamento do doente**, guardadas no perfil e não só numa entrada de
  lista de espera. São **suaves**: nunca eliminam um horário, apenas o despromovem, e quem
  marca é avisado quando nenhuma sugestão respeita tudo o que o doente pediu

### Inteligência de agenda
- **Risco de falta** por consulta futura, a partir do histórico do doente (faltas e
  cancelamentos anteriores, antecedência da marcação) — `lib/noShowRisk.ts`
- **Heatmap** de faltas e cancelamentos por dia da semana e hora
- **Outreach proativo**: consultas de risco elevado (≥ 60) e próximas (≤ 3 dias) recebem um
  pedido de confirmação distinto do lembrete normal
- **Métricas de eficiência**: ocupação por cadeira e por dentista, fragmentação,
  cancelamentos de última hora, procura da lista de espera por dia
- **Otimizador** (`lib/scheduleOptimizerCalc.ts`): passa do diagnóstico à proposta concreta,
  com a consulta, o destino e os minutos recuperados. Quatro regras — encaixe (com alocação
  exclusiva: cada entrada da lista é atribuída no máximo a um espaço, e o ganho é o tempo
  que os doentes ocupam de facto, nunca o tamanho do buraco), consulta sem dentista,
  libertação da cadeira com equipamento único, e consulta que contraria as preferências do
  doente. **Read-only por desenho**: propõe, nunca aplica — mover uma consulta obriga a
  avisar o doente, e essa decisão é de quem atende

### Aquisição e ciclo de vida
- **Leads**: registo de contactos ainda não convertidos, com origem, e conversão em doente
  (faz match por telefone com um doente existente ou cria um novo)
- **Fontes de captação** (`lead_capture_sources`): cada site, landing page ou formulário
  externo recebe um bearer token próprio e cria leads sem sessão de pessoal
- **Ciclo de vida**: classificação de cada doente num estágio (novo, em tratamento, estável,
  inativo) com reativação automática por SMS — só para quem tem consentimento de marketing
  registado e está fora do período de cooldown
- **Quadro de jornada** (`lib/patientJourneyCalc.ts`): vista Kanban mais fina, de lead a
  nova consulta, para priorização
- **Recuperação de receita**: identifica valor perdido (planos apresentados e não aceites,
  vagas vazias) e calcula o potencial recuperável, com snapshots periódicos

### Financeiro
- Faturação interna com linhas de item, pagamentos parciais ou totais, métodos (Multibanco,
  seguro, numerário) e saldo em dívida
- Faturas ligadas à consulta que as gerou (migração 042)
- Estatísticas financeiras por clínica

> **Esta plataforma não processa pagamentos nem emite documentos fiscais.** Regista o valor
> e a conta corrente do doente; a fatura legal é emitida pelo software certificado da
> clínica.

### Operações da clínica
- **Checklists**: modelos por clínica e corridas do dia, com lembretes automáticos
- **Incidentes**: registo por quem está ao balcão ou no gabinete, escalamento automático
  para a direção quando ficam por resolver
- **Passagem de turno** (`shift_handoffs`): rascunho pré-preenchido a partir do estado real
  da clínica — doentes ainda no espaço, tarefas abertas, incidentes por fechar, checklists
  por concluir, ofertas sem resposta. Guardada congelada como texto (uma passagem é o que
  foi dito naquele momento, não uma vista que se recalcula), com confirmação de leitura pelo
  turno seguinte; **quem escreve não pode confirmar a própria passagem**. Turnos partidos
  são suportados
- **Distribuição automática de tarefas** (`lib/taskRoutingCalc.ts`): cruza papel elegível,
  quem está de turno agora, quem não está de férias e quem tem menos tarefas abertas.
  Determinista, com desempate por nome. O filtro de papel é estrito e sem fallback — sem
  rececionista disponível a tarefa fica na fila partilhada em vez de cair num clínico — e
  uma escolha humana explícita nunca é contrariada
- **Horários e ausências** da equipa (`staff_schedules`, `staff_time_off`)

### Inventário e equipamento
- Catálogo global de itens, com **ponto de reposição por clínica** (uma clínica com três
  cadeiras e outra com doze não repõem no mesmo ponto)
- Stock por clínica, lotes com validade, movimentos e consumo por procedimento
- **Previsão** de rutura e de expiração (`lib/inventoryCalc.ts`), alertas de stock baixo
- **Fornecedores** e **encomendas** — o rascunho de reposição pode ser decidido pela IA, mas
  nunca sai de `draft` sozinho: avançar para o fornecedor exige uma pessoa
- **Equipamento** da clínica com plano e lembretes de manutenção

### Portal do doente e comunicação
- **Portal sem login**: link de uso único (token guardado apenas em hash) onde o doente
  completa dados em falta, envia um documento pedido ou assina um consentimento pendente.
  A recolha é self-service; a validação continua a ser um passo humano, criado como tarefa
- **Preferências de comunicação** por doente: um canal marcado como "não contactar" bloqueia
  todo o envio automático (`lib/commPrefs.ts`) — lembretes, outreach de risco, reativação,
  recalls e ofertas de vaga. Envios feitos por uma pessoa não são afetados
- **Interações** registadas por doente, para haver um sítio único onde se vê o que já foi
  dito

### Documentação administrativa
Geração de declarações, justificações e cartas — **sem qualquer conteúdo clínico**, por
desenho.
- Modelos com marcadores `{{variável}}` de um catálogo fechado; um marcador desconhecido é
  recusado ao gravar o modelo, e não descoberto com o doente à frente
- Preset PT de 4 modelos (declaração de presença, justificação de falta, declaração de
  acompanhante, carta de encaminhamento), aplicável com um clique e idempotente
- O documento emitido é uma **cópia congelada**: editar o modelo depois não reescreve nada já
  entregue. Sem PUT nem DELETE na API, pela mesma razão que `audit_log` não os tem
- Impressão direta do browser, sem dependências novas

### Campos dinâmicos
Campos definidos pelo admin (string, boolean, integer, decimal, enum, uuid_ref), aplicáveis
por clínica ou globalmente, com percentagem de rollout e obrigatoriedade.

---

## Agentes

Seis agentes (`lib/agents/registry.ts`), cada um com um domínio, uma fronteira explícita e o
conjunto de jobs que já governa. O ponto importante: **nenhum agente é trabalho novo a
inventar** — são jobs determinísticos que já corriam, agrupados por quem decide o quê. O
catálogo é só dados (sem BD, sem IA), por isso testa-se sem Postgres.

| Agente | Domínio | Fronteira |
|--------|---------|-----------|
| 📞 **Lead** | Do primeiro contacto até virar doente: qualifica a intenção e escreve o rascunho da resposta | Nunca envia sozinho — falar com alguém de fora exige uma pessoa a clicar |
| 👤 **Doente** | Contexto do doente e próxima ação: planos por aceitar, recall, reativação | Coordena; não pratica atos clínicos nem decide tratamento |
| 📅 **Agenda** | Encaixa procura nos recursos: cadeiras, especialidade, lista de espera, risco de falta | Agenda de doentes; turnos e férias são de Operações |
| 💳 **Finanças** | Dinheiro já faturado: cobrança, pendentes, saldo em dívida | Antes da fatura existir, o assunto é do Doente/Lead |
| ⚙️ **Operações** | Checklists, incidentes, passagem de turno, stock, reposição, manutenção | A IA decide o rascunho de encomenda, mas nunca sai de `draft` |
| 🔐 **Conformidade** | RGPD, retenção e auditoria: prazos vencidos e pedidos do titular | Prepara e sinaliza — nunca apaga |

A comunicação não é um agente: é o canal por onde todos passam, e por isso a política
(consentimento, canal preferido, deduplicação) vive num sítio só, com o job `send` como
saída única.

Onde a IA entra hoje, em concreto: `reorderAgent` decide o rascunho de reposição de stock
(sem chave, cai para a regra fixa), `leadAgent` qualifica leads e escreve o rascunho de
resposta (sem chave, simplesmente não faz triagem — não há regra fixa equivalente), e os
agentes de análise escrevem insights em `agent_insights`, substituindo em cada corrida os
que ainda estão por tratar e preservando o histórico dos já resolvidos.

---

## Jobs em segundo plano

Pipeline central em `lib/jobsRunner.ts`, corrido por `scripts/run-jobs.ts` (cron ou o serviço
`jobs` do Docker Compose) ou sob pedido de um admin. 24 jobs, todos por clínica:

| Grupo | Jobs |
|-------|------|
| Agenda | `reminders`, `risk`, `riskOutreach`, `waitlistExpire`, `scheduleReview` |
| Doente | `assignTasks`, `planFollowup`, `recallOutreach`, `lifecycleOutreach`, `patientReview` |
| Lead | `leadTriage`, `leadFollowup`, `leadSourceReview` |
| Finanças | `summary`, `recovery`, `financeReview` |
| Operações | `escalateIncidents`, `checklistReminders`, `handoffReminders`, `reorderSuggestions`, `equipmentMaintenance` |
| Conformidade | `retention`, `retentionPolicies` |
| Comunicação | `send` |

Cada execução fica registada em `job_runs` (com `tenant_id NULL` para os jobs de plataforma)
e no `audit_log`. O envio efetivo é feito por SMS via API REST da Twilio; sem
`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` o envio degrada com
elegância — fica em fila com retry agendado, sem rebentar o pipeline.

---

## RGPD

O que está de facto implementado, e não apenas previsto no schema:

- **Consentimentos** (`patient_data_consents`) verificados antes de qualquer contacto
  automático de marketing/reativação
- **Direitos do titular** (`lib/dataSubject.ts`, artigos 15.º a 20.º): pedidos registados,
  exportáveis e cumpríveis. Toda a tabela com coluna `patient_id` tem de declarar aqui o que
  lhe acontece num pedido de acesso ou apagamento — e
  `test/integration/data-subject-coverage.test.ts` compara essa lista com o catálogo do
  Postgres e falha se alguém acrescentar uma tabela ligada a um doente sem decidir
- **Apagamento**: não é um `DELETE`. O processo clínico e os documentos fiscais têm
  obrigações de conservação que se sobrepõem ao artigo 17.º (n.º 3, al. b), por isso o que se
  apaga é a ligação a uma pessoa identificável — a linha de `patients` fica como âncora das
  chaves estrangeiras, com estado próprio `anonymized` para não reaparecer em listas,
  campanhas ou contagens de doentes ativos (migração 037)
- **Políticas de conservação** (`lib/retention.ts`) aplicadas por categoria, com uma postura
  deliberada: categorias operacionais (mensagens enviadas, leads não convertidos, tokens
  expirados) são executadas automaticamente; tudo o que toca no processo clínico **não é
  apagado pelo job** — cria uma tarefa para a direção rever. Apagar registo clínico tarde é
  uma não-conformidade; apagá-lo por engano é irreversível

> **Limite honesto**: isto implementa a mecânica, não a decisão jurídica. Os prazos concretos
> não estão fixados no código de propósito — vivem em `data_retention_policies`, por clínica,
> para que quem os define seja quem tem competência para isso. Confirmar com jurista antes de
> produção.

---

## Testes

```bash
npm run test              # 307 unitários, 27 ficheiros — sem base de dados
npm run test:integration  # 107 de integração, 19 ficheiros — precisa do PostgreSQL de .env.test
npm run test:all
```

Os unitários cobrem a lógica pura (`lib/*Calc.ts` e afins): risco de falta, matching de lista
de espera, otimizador de agenda, distribuição de tarefas, disponibilidade de pessoal,
previsão de inventário, permissões, marcadores de documentos, agentes. Os de integração
correm contra um PostgreSQL real e cobrem os invariantes que só existem lá: isolamento entre
clínicas, cobertura de RLS, cobertura de tabelas ligadas ao doente para efeitos de RGPD,
limite de login partilhado, e a ausência de oráculo no login.

---

## Comandos npm

| Comando | Função |
|---------|--------|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` / `start` | Build e servidor de produção |
| `npm run test` / `test:integration` / `test:all` | Testes |
| `npm run lint` / `lint:fix` / `format` | Biome |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | Aplica as migrações por aplicar |
| `npm run db:seed` | Semeia dados demo (`-- --with-demo-users` para as contas de demonstração) |
| `npm run db:reset` | Reset e nova sementeira |
| `npm run create-admin` | Cria o super admin da plataforma. Só funciona se ainda não existir nenhum |
| `npm run jobs:run` | Corre o pipeline de jobs uma vez, para todas as clínicas ativas |

---

## Variáveis de ambiente

Há um `.env.example` na raiz com todas elas comentadas — copiar para `.env` e preencher.

| Variável | Função | Default |
|----------|--------|---------|
| `DATABASE_URL` | Ligação admin/owner, com DDL e acesso cross-tenant. Usada por `db:migrate`, `db:seed` e o runner de jobs | `postgresql://postgres:password@localhost:5432/portucale_dental` |
| `APP_DATABASE_URL` | **Obrigatória em produção.** Ligação restrita (papel `portucale_app`) sujeita a RLS, usada pela app. Sem ela, `lib/db.ts` recusa arrancar com `NODE_ENV=production` — o fallback correria como dono do schema e desligaria o isolamento entre clínicas em silêncio | — |
| `PORTUCALE_ADMIN_CONNECTION` | Escotilha para processos de manutenção que precisam mesmo da ligação admin (hoje só `scripts/run-jobs.ts`). **Nunca definir no servidor web** | — |
| `JWT_SECRET` | Chave de assinatura. Gerar com `openssl rand -base64 48` | — |
| `JWT_SECRETS` | Segredos ANTIGOS ainda aceites a verificar (lista por vírgulas). Assina-se sempre com `JWT_SECRET` | Opcional |
| `JWT_TTL_SECONDS` | Validade do token | `604800` (7 dias) |
| `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` | Cloudflare R2. Sem isto, os uploads ficam em disco local | Opcional |
| `UPLOAD_RETENTION_DAYS` | Retenção de ficheiros | `90` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS | Opcional |
| `ANTHROPIC_API_KEY` | IA: agente Operações (reposição) e agente Lead (triagem) | Opcional — cada um degrada à sua maneira |
| `JOB_INTERVAL_SECONDS` | Intervalo do serviço `jobs` do Docker Compose | `900` |
| `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD` | Só para `npm run create-admin` | — |

> **`R2_ENDPOINT` e `R2_PUBLIC_BASE_URL` são lidas em BUILD TIME**, não em runtime:
> `next.config.mjs` usa-as para montar o `Content-Security-Policy`, que fica gravado em
> `.next`. Defini-las apenas no ambiente de execução chega tarde demais, e a CSP publicada
> bloqueia os próprios uploads. É por isso que o `Dockerfile` as recebe como `ARG` antes do
> `npm run build`.

---

## Docker

```bash
docker compose up -d
```

| Serviço | Imagem | Porta | Função |
|---------|--------|-------|--------|
| `postgres` | postgres:17-alpine | 127.0.0.1:5432 | Base de dados. Aplica `schema.sql` e cria o papel `portucale_app` no primeiro arranque |
| `migrate` | Build (stage `builder`) | — | Corre `scripts/migrate.ts` uma vez e sai. `app` e `jobs` esperam pela conclusão (`service_completed_successfully`) |
| `pgadmin` | dpage/pgadmin4:9 | 127.0.0.1:5050 | Interface de gestão da BD |
| `app` | Build multi-stage | 3000 | Aplicação Next.js, ligada por `APP_DATABASE_URL` (com RLS) |
| `jobs` | Build (stage `builder`) | — | Corre `scripts/run-jobs.ts` em ciclo. Usa deliberadamente a ligação admin: lê através de todas as clínicas, sem sessão que o delimite, tal como `scripts/migrate.ts` |

`POSTGRES_APP_PASSWORD`, `PGADMIN_PASSWORD` e `JWT_SECRET` são obrigatórias — o Compose
recusa arrancar sem elas.

> **Porque existe um serviço só para migrar.** O `initdb` do Postgres aplica apenas
> `scripts/schema.sql`, que define 32 das 61 tabelas: `patients`, `patient_tasks`,
> `inventory_items`, `suppliers`, `shift_handoffs` e mais duas dezenas nascem das migrações
> em `scripts/migrations/`. Sem o serviço `migrate`, `docker compose up -d` levantava uma
> app que arranca e serve tráfego, e falha em quase todas as páginas por tabelas que não
> existem. `scripts/migrate.ts` corre tudo numa transação única com `ROLLBACK` em erro e
> salta o que já está em `schema_migrations`, por isso repetir o `up` é um no-op.

O Compose não semeia dados. Depois do primeiro `up`, criar o super admin uma vez:

```bash
docker compose run --rm \
  -e ADMIN_EMAIL=... -e ADMIN_NAME="..." -e ADMIN_PASSWORD=... \
  migrate node --import tsx scripts/create-admin.ts
```

---

## Padrões arquitetónicos

1. **Validação no servidor**: todas as rotas validam entradas com `lib/validate.ts` e
   verificam uma ação com `lib/permissions.ts`. O cliente nunca é a autoridade
2. **Trilho de auditoria**: cada mutação passa por `appendAudit()` e, quando toca num doente,
   `appendTimeline()` — ambos encadeados por hash no trigger
3. **CSRF double-submit** e verificação de origem em todas as mutações
4. **Isolamento em duas camadas**: `tenant_id` na aplicação e RLS no PostgreSQL, para que um
   esquecimento numa não seja suficiente para vazar
5. **Lógica pura separada da BD**: o que decide (`*Calc.ts`) não sabe SQL, o que sabe SQL não
   decide. É o que torna 307 testes possíveis sem base de dados
6. **Máquina de estados na BD**: as transições de consulta são validadas contra `statuses`, e
   as inválidas devolvem 400
7. **Catálogos por clínica**: `tenant_id NULL` é o global, uma linha com `tenant_id` é o
   override. Sem cópia por clínica
8. **Estado no cliente**: React Context (`AuthProvider`) com um helper `api()` centralizado
   que trata do CSRF, e as tabelas de referência resolvidas uma vez para a clínica em causa
9. **Automatismo com fronteira**: tudo o que sai da clínica para uma pessoa de fora, e tudo o
   que é irreversível, exige um humano — os agentes preparam, não executam

---

## Limitações conhecidas

| Área | Estado atual | Caminho |
|------|--------------|---------|
| Rate limit genérico de `/api/*` | Em memória, por instância (o do login já é partilhado) | Redis, ou a mesma tabela `rate_limit_counters` se o middleware sair do Edge |
| Tempo real | Refetch depois da ação | WebSockets (Pusher / Ably) |
| Notas clínicas | Texto simples na BD | Cifra ao nível da coluna com KMS por clínica |
| Faturação | Registo interno de valores | Integração com software certificado para o documento fiscal |
| Auth | JWT próprio | Suficiente hoje; NextAuth/Clerk se houver necessidade de SSO |
| Deploy | Docker Compose / localhost | VPC privada com Postgres gerido |

---

## Licença

Projeto privado — Portucale Dental
