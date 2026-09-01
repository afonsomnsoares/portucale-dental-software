# Portucale Dental

**Next.js 16 · React 19 · PostgreSQL · Full Stack · App Router**

Plataforma SaaS multi-tenant para gestao de clinicas dentarias, concebida para o mercado portugues. Interface totalmente em portugues (pt-PT).

---

## Sumario do Projeto

O Portucale Dental e uma aplicacao web full-stack completa para gestao de clinicas dentarias. Suporta multi-tenancy (varias clinicas num unico deploy), tres roles de utilizador com controlo de acesso granular, e inclui funcionalidades clinicas avancadas como odontograma 2D/3D, dictacao por voz, planos de tratamento, agenda inteligente orientada a risco de no-show, recuperacao de receita e reativacao de pacientes inativos.

---

## Stack Tecnologica

| Camada | Tecnologia | Versao | Funcao |
|--------|-----------|--------|--------|
| Framework | Next.js | ^16.2.3 | Full-stack (App Router) |
| UI | React | ^19.2.0 | Biblioteca de componentes |
| Linguagem | TypeScript | ^5.8.3 | Tipo estatico |
| Base de dados | PostgreSQL | 17 (Docker) | BD principal |
| ORM/Driver | pg | ^8.11.5 | Ligacao PostgreSQL |
| Estilo | Tailwind CSS | ^3.4.4 | CSS utility-first |
| Icones | Lucide React | ^1.22.0 | Biblioteca de icones |
| 3D | React Three Fiber | ^9.6.1 | Odontograma 3D |
| 3D Engine | Three.js | ^0.185.0 | Graficos 3D |
| Voz | Web Speech API | Nativo | Dictacao clinica (pt-PT) |
| Auth | JWT custom + bcrypt | HMAC-SHA256 | Autenticacao |
| IA | @anthropic-ai/sdk (Claude) | ^0.120.0 | Diagnostico automatico de relatorios |
| SMS | Twilio (API REST) | -- | Lembretes e notificacoes |
| Upload | Cloudflare R2 | S3-compativel | Armazenamento de ficheiros |
| Linter | Biome | ^2.5.0 | Lint + formatacao |
| Git Hooks | Husky | ^9.1.7 | Pre-commit hooks |
| Testes | node:test | Nativo | 57 testes unitarios, 8 ficheiros |
| Container | Docker Compose | Multi-stage | Producao |

---

## Estrutura do Projeto

```
portucale_dental/
├── scripts/
│   ├── schema.sql                    ← Schema completo PostgreSQL (30+ tabelas)
│   ├── seed.ts                       ← Dados demo (clinica, utilizadores, pacientes)
│   ├── migrate.ts                    ← Runner de migracoes
│   ├── check-dburl.ts                ← Diagnostico DATABASE_URL
│   └── migrations/                   ← 7 migracoes incrementais (features clinicas,
│                                        recuperacao de receita, leads, agenda
│                                        inteligente, ciclo de vida, privilegios BD)
│
├── lib/
│   ├── auth.ts                       ← JWT sign/verify, CSRF, helpers de auth
│   ├── audit.ts                      ← Audit log append-only + patient timeline
│   ├── constants.ts                  ← Design tokens, nav, codigos TANOMD
│   ├── customFields.ts               ← Normalizacao de campos dinamicos
│   ├── db.ts                         ← Pool PostgreSQL singleton
│   ├── http.ts                       ← Helpers de resposta HTTP
│   ├── permissions.ts                ← Sistema de permissoes por role
│   ├── rateLimit.ts                  ← Rate limiting em memoria
│   ├── r2.ts                         ← Cliente Cloudflare R2 / S3
│   ├── validate.ts                   ← Validacao de inputs
│   ├── jobsRunner.ts                 ← Pipeline de jobs em segundo plano (envia SMS via Twilio)
│   ├── waitlist.ts / waitlistMatch.ts ← Lista de espera e motor de matching de vagas
│   ├── scheduleIntel.ts / noShowRisk.ts ← Risco de no-show e agenda inteligente
│   ├── recovery.ts / recoveryCalc.ts ← Recuperacao de receita
│   ├── lifecycle.ts / lifecycleCalc.ts ← Ciclo de vida e reativacao de pacientes
│   └── reports.ts / reportsCalc.ts   ← Relatorios e comparacao entre clinicas
│
├── components/
│   ├── ui.tsx                        ← Primitivas UI (Badge, Card, Modal, Table...)
│   ├── Sidebar.tsx                   ← Navegacao lateral por role
│   ├── DayCalendar.tsx               ← Vista diaria estilo Google Calendar
│   ├── Odontogram.tsx                ← Odontograma interativo 32 dentes (2D)
│   ├── Odontogram3D.tsx              ← Odontograma 3D (React Three Fiber)
│   ├── TreatmentTable.tsx            ← Tabela de tratamentos com edicao inline
│   ├── dentist/
│   │   └── PatientNotesTab.tsx       ← Notas clinicas com dictacao por voz
│   └── receptionist/
│       ├── AppointmentsTable.tsx     ← Tabela de consultas com status
│       └── AppointmentEditModal.tsx  ← Modal de edicao de consulta
│
├── hooks/
│   └── useSpeechRecognition.ts       ← Hook Web Speech API (dictacao pt-PT)
│
├── test/                             ← 8 ficheiros de teste (node:test nativo):
│                                        auth, permissions, r2, reportsCalc, recovery,
│                                        waitlistMatch, noShowRisk, lifecycleCalc
│
├── app/
│   ├── globals.css                   ← Estilos globais (Tailwind + CSS variables)
│   ├── login.module.css              ← CSS module pagina de login
│   ├── layout.tsx                    ← Layout raiz (AuthProvider, fonts)
│   ├── page.tsx                      ← Pagina de login
│   ├── providers.tsx                 ← AuthContext + api() helper + CSRF
│   │
│   ├── api/                          ← BACKEND (~60 rotas de API)
│   │   ├── auth/                     ← csrf, login, logout, me
│   │   ├── patients/                 ← CRUD, import em massa, timeline, dentes, historial medico
│   │   ├── appointments/             ← CRUD + transicoes de estado
│   │   ├── treatments/               ← Tratamentos
│   │   ├── invoices/                 ← Faturacao + pagamentos
│   │   ├── notes/                    ← Notas clinicas
│   │   ├── uploads/                  ← Upload + presign R2
│   │   ├── prescriptions/ lab-orders/ treatment-plans/
│   │   │   recalls/ consent-forms/   ← Fluxo clinico
│   │   ├── waitlist/                 ← Lista de espera + ofertas de vaga
│   │   ├── schedule-intel/           ← Risco de no-show, heatmap, eficiencia
│   │   ├── recovery/                 ← Recuperacao de receita
│   │   ├── lifecycle/                ← Ciclo de vida e reativacao de pacientes
│   │   ├── leads/                    ← Leads e conversao em paciente
│   │   ├── reports/                  ← Resumo, comparacao e analise por IA
│   │   ├── tenants/ users/ schema/
│   │   │   permissions/ audit/       ← Administracao da plataforma
│   │   ├── inventory/ settings/      ← Inventario e tabelas de referencia
│   │   └── jobs/run/                 ← Disparo manual do pipeline de jobs
│   │
│   └── dashboard/
│       ├── layout.tsx                ← Auth guard + sidebar shell
│       ├── admin/                    ← Clinicas, utilizadores, schema, permissoes,
│       │                                auditoria, financas, inventario, relatorios,
│       │                                recuperacao, ciclo de vida, agenda inteligente
│       ├── receptionist/             ← Calendario, marcacoes, pacientes, leads,
│       │                                tratamentos, faturas, sala de espera, recalls
│       └── dentist/                  ← Pacientes, odontograma, notas, historial medico,
│                                        prescricoes, lab, planos, recalls, consentimentos
```

---

## Base de Dados

Schema completo com **30+ tabelas** PostgreSQL, definido em `scripts/schema.sql` e evoluido por 7 migracoes incrementais:

| Tabela | Funcao |
|--------|--------|
| `tenants` | Entidades multi-tenant (clinicas) |
| `users` | Contas de utilizador (admin, rececionista, dentista) |
| `patients` | Registos de pacientes com campos RGPD |
| `patient_alerts` | Alertas medicos de pacientes |
| `appointments` | Consultas agendadas com maquina de estados |
| `teeth` | Condicao por dente (1-32) |
| `treatments` | Registos de tratamento com codigos TANOMD |
| `invoices` | Faturacao com acompanhamento de pagamentos |
| `patient_timeline` | Log imutavel com hash SHA-256 dos eventos do paciente |
| `schema_fields` | Campos dinamicos por tenant |
| `treatment_codes` | Codigos de procedimentos dentarios TANOMD |
| `tooth_conditions` | Definicoes de condicoes do odontograma |
| `statuses` | Definicoes da maquina de estados de consultas |
| `audit_log` | Log de auditoria forense (REVOKE UPDATE/DELETE) |
| `inventory_items` | Itens mestre de inventario |
| `inventory_stock` | Quantidades por tenant |
| `role_permissions` | Permissoes granulares por tenant |
| `notifications` | Fila de notificacoes por SMS |
| `job_runs` | Acompanhamento de jobs de background |
| `uploads` | Registos de upload de ficheiros |
| `medical_history` | Anamnese do paciente (alergias, medicacoes) |
| `prescriptions` | Prescricoes eletronicas |
| `lab_orders` | Encomendas de laboratorio |
| `treatment_plans` | Planos de tratamento multi-fase |
| `recalls` | Agendamentos de recall |
| `consent_forms` | Documentos de consentimento |
| `leads` | Contactos ainda nao convertidos em pacientes |
| `waitlist_entries` | Inscricoes na lista de espera |
| `slot_offers` | Ofertas de vaga enviadas a candidatos da lista de espera |
| `patient_lifecycle_state` | Ultimo estagio de ciclo de vida conhecido por paciente + data do ultimo contacto de reativacao |
| `patient_data_consents` | Consentimentos de dados RGPD -- so este esta em uso real, ver seccao 13 |
| `data_subject_requests` | Pedidos RGPD (acesso, apagamento...) -- schema apenas, sem API/UI |
| `processing_activities` | Registo de atividades de tratamento -- schema apenas, sem API/UI |
| `data_retention_policies` | Politicas de retencao de dados -- schema apenas, sem API/UI |
| `dpo_contacts` | Contactos do DPO -- schema apenas, sem API/UI |
| `privacy_notices` | Versionamento de politicas de privacidade -- schema apenas, sem API/UI |

---

## Funcionalidades Principais

### 1. Arquitectura Multi-Tenant
- Motor de provisioning de novas clinicas (nome, cidade, gabinetes)
- Isolamento por `tenant_id` em todas as tabelas principais
- Super Admin (sem tenant) com visao global de todas as clinicas
- Campos dinamicos podem ser implementados por tenant ou globalmente

### 2. Controlo de Acesso por Roles (3 Roles)

| Role | Acesso |
|------|--------|
| **Super Admin** | Gestao de clinicas, utilizadores, auditoria, esquema, permissoes, inventario, relatorios, financeiro |
| **Rececionista** | Registo de pacientes, leads, marcacao de consultas, tratamentos, faturacao, kanban de chao, recalls |
| **Dentista** | Registos de pacientes, odontograma, historial medico, prescricoes, encomendas lab, planos de tratamento, notas clinicas, consentimentos, imagiologia, recalls |

### 3. Autenticacao e Seguranca
- **JWT custom** (HMAC-SHA256) com suporte a rotacao de multiplos secrets
- **bcrypt** para hashing de passwords
- **Protecao CSRF** via padrao double-submit cookie
- **Rate limiting**: limite generico sobre toda a API (240 pedidos/min por utilizador autenticado, 60/min por IP anonimo), mais um limite dedicado no login (10 tentativas/10 min por IP+email) -- implementado em memoria, por instancia. Nao escala horizontalmente: com multiplas instancias/replicas cada uma tem o seu contador. Para producao multi-instancia substituir por Redis ou equivalente. Ver `lib/rateLimit.ts`
- **Criacao do primeiro super admin**: nao existe ecra de auto-registo -- a conta e criada uma unica vez pelo operador via `npm run create-admin` (ver `scripts/create-admin.ts`). Cada utilizador seguinte (admin de clinica, rececionista, dentista) e criado por esse super admin dentro do dashboard.
- **Isolamento por clinica**: reforcado na generalidade das rotas de leitura/escrita via `tenant_id`. A rota `/api/audit` foi corrigida para nunca deixar um admin de clinica ler o log de auditoria de outra clinica -- antes, qualquer conta com role `admin` via o log completo, independentemente do tenant
- **Verificacao de origem** em todas as mutacoes
- **Guards de rota** por role no middleware e no layout do dashboard

### 4. Maquina de Estados de Consultas
Transicoes validadas pelo servidor:
```
confirmed/registered → waiting → in-operatory → procedure-active → ready-dismissal → departed
                                                                                    \-> no-show
```
Transicoes invalidas retornam HTTP 400.

### 5. Sistema de Risco de No-Show
Calculado por paciente:
```sql
ROUND((no_show_count::numeric / NULLIF(visit_count, 0)) * 100)
```
Apresentado como badges coloridos: ALTO >= 60%, MEDIO >= 30%, BAIXO < 30%.

### 6. Timeline Imutavel do Paciente
Cada mutacao (mudanca de estado, atualizacao de dente, tratamento, fatura, nota) escreve uma linha imutavel com hash **SHA-256** em `patient_timeline`. Apresentada nas vistas de rececionista e dentista.

### 7. Vault de Auditoria Forense
Cada mutacao API regista em `audit_log` com: user_name, user_role, clinic, action, resource, before_val, after_val, hash. A tabela tem `REVOKE UPDATE, DELETE` -- append-only a nivel de base de dados.

### 8. Odontograma (2D + 3D)
- **Grafico interativo de 32 dentes** com arcadas superior (1-16) e inferior (17-32)
- Clique num dente para definir condicao (saudavel, caries, obturacao, coroa, ausente, impactado, canal, ponte, implante)
- Marcacao de superficies afetadas (Oclusal, Mesial, Distal, Vestibular, Lingual)
- Indicador a laranja para dentes com tratamentos ativos
- **Versao 3D** com React Three Fiber, controles orbitais, rotacao automatica e visualizacao em tempo real
- Adicionar tratamentos codificados TANOMD diretamente do odontograma

### 9. Notas Clinicas com Dictacao por Voz
- Integracao com **Web Speech API** para dictacao em portugues (pt-PT)
- Visualizacao de transicao em tempo real + transricao final
- Suporte a anexos (imagens, PDFs)
- Tags e metadados de ligacao
- Editor monospace com historico

### 10. Codigos de Tratamento TANOMD
Conjunto completo de **30+ codigos** de procedimentos dentarios portugueses:
- 01 Consulta
- 02 Medicina Dentaria Preventiva
- 03 Dentisteria Operatoria
- 04 Endodontia
- 05 Cirurgia Oral
- 06 Periodontologia
- 07 Implantologia
- 08 Protese
- 10 Radiologia

### 11. Vista de Calendario Diario
- Vista estilo **Google Calendar** (07:00 - 17:00)
- Blocos de consulta posicionados com offsets de lane
- Linha vermelha "agora"
- Clique para selecionar com badge de status e score de risco
- Botao de avanco de status com um clique

### 12. Gestao Financeira
- Criacao de faturas com linhas de item
- Processamento de pagamentos (parcial/completo)
- Metodos de pagamento (Multibanco, seguro, numerario)
- Dashboard de estatisticas financeiras
- Acompanhamento de saldos em divida

### 13. Conformidade RGPD
O schema reserva seis tabelas para proteccao de dados (`patient_data_consents`, `data_subject_requests`, `processing_activities`, `data_retention_policies`, `dpo_contacts`, `privacy_notices`), mas **so `patient_data_consents` esta de facto em uso** -- e so em leitura, como condicao antes de enviar o SMS de reativacao de ciclo de vida (seccao 15). As restantes cinco existem na base de dados mas nao tem nenhuma rota de API nem interface construida sobre elas.

**Nao apresentar este produto como "conforme com o RGPD"** enquanto os pedidos de titulares de dados, o registo de atividades e as politicas de retencao nao tiverem um fluxo funcional real -- neste momento e so estrutura de base de dados preparada, nao uma funcionalidade entregue.

### 14. Funcionalidades Clinicas
- **Historial medico** (anamnese): alergias, medicacoes, condicoes, historial familiar, tabagismo, gravidez
- **Prescricoes**: medicacao, dosagem, frequencia, via, duracao, renovacoes, instrucoes
- **Encomendas de laboratorio**: nome do lab, tipo de caso, dentes, custo, tracking
- **Planos de tratamento**: planos multi-fase com workflow de aprovacao e assinaturas digitais
- **Formularios de consentimento**: consentimento especifico por procedimento
- **Agendamentos de recall**: intervalos configuraveis (checkup, profilaxia, follow-up)
- **Imagiologia**: gestao de imagens dentarias -- atualmente com dados de demonstracao, ainda sem upload real (ver `app/api/imaging/route.ts`)

### 15. Lista de Espera (Waitlist)
- Inscricao de pacientes com preferencias (dentista, dias, horario, duracao minima)
- Quando uma consulta e cancelada, o motor de matching (`lib/waitlistMatch.ts`) ordena os candidatos ativos e oferece a vaga por SMS aos melhores encaixes
- Ofertas expiram ao fim de 24h; o proprio pipeline de jobs marca as ofertas expiradas

### 16. Agenda Inteligente (Schedule Intelligence)
- **Risco de no-show** por consulta futura, calculado a partir do historico do paciente (faltas/cancelamentos passados, antecedencia da marcacao) -- ver `lib/noShowRisk.ts`
- **Heatmap** de faltas/cancelamentos por dia da semana e hora
- **Outreach proativo por SMS**: consultas de risco elevado (score >= 60) e proximas (<= 3 dias) recebem um pedido de confirmacao automatico, distinto do lembrete normal
- Metricas de eficiencia da agenda

### 17. Recuperacao de Receita (Revenue Recovery)
- Identifica valor "perdido" -- planos de tratamento apresentados mas nao aceites, vagas vazias na agenda -- e calcula o potencial de receita recuperavel
- Snapshots periodicos guardados pelo pipeline de jobs (`lib/recovery.ts`)

### 18. Ciclo de Vida do Paciente (Lifecycle)
- Classifica cada paciente num estagio (novo, estavel, inativo...) com base no historico de visitas
- Pacientes inativos com consentimento de marketing dado (`patient_data_consents`) e fora do periodo de cooldown recebem SMS de reativacao automatico (`lib/lifecycle.ts`)

### 19. Leads
- Registo de contactos que ainda nao sao pacientes (nome, telefone/email, origem)
- Conversao de lead em paciente real -- por telefone, faz match com paciente existente ou cria um novo (`app/api/leads/route.ts`)

### 20. Relatorios & Analise por IA
- Resumo e comparacao de desempenho entre clinicas (receita, ocupacao, conversao de planos, no-show)
- **Analise por IA** (Claude, via `@anthropic-ai/sdk`) que gera um diagnostico em texto a partir das metricas calculadas -- degrada graciosamente se `ANTHROPIC_API_KEY` nao estiver definida

### 21. Inventario Multi-Clinica
- Itens mestre com limiares de reabastecimento
- Quantidades por tenant
- Alertas de stock baixo / sem stock

### 22. Campos Dinamicos
- Campos definidos pelo admin (string, boolean, integer, decimal, enum, uuid_ref)
- Implementacao por tenant ou global com percentagens de rollout
- Enforco de campos obrigatorios

### 23. Notificacoes SMS & Jobs em Segundo Plano
- Pipeline central (`lib/jobsRunner.ts`), corrido por cron (`scripts/run-jobs.ts`) ou sob pedido de admin, que processa por clinica: lembretes de consulta, outreach de risco, reativacao de ciclo de vida, envio de SMS pendentes, expiracao de ofertas de lista de espera, limpeza de uploads antigos, resumo noturno e snapshot de recuperacao de receita
- Envio efetivo por SMS via API REST da **Twilio** (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) -- sem estas variaveis, o envio degrada graciosamente (fica em fila com retry agendado, sem rebentar o pipeline)

---

## Credenciais Demo

Criadas com `npm run db:seed -- --with-demo-users`. **So para desenvolvimento/demonstracao -- nunca usar em producao.**

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@portucale.dental | admin123 |
| Recepcionista | reception@nyc.io | recep123 |
| Dentista | dentist@nyc.io | dent123 |

---

## Comandos NPM

| Comando | Funcao |
|---------|--------|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de producao |
| `npm run start` | Servidor de producao |
| `npm run test` | Executar testes (57 testes, 8 ficheiros) |
| `npm run lint` | Verificar lint (Biome) |
| `npm run lint:fix` | Corrigir lint automaticamente |
| `npm run format` | Formatar codigo |
| `npm run typecheck` | Verificacao de tipos TypeScript |
| `npm run db:seed` | Semear base de dados com dados demo |
| `npm run db:reset` | Resetar e semear novamente |
| `npm run db:migrate` | Executar migracoes |
| `npm run create-admin` | Criar o super admin da plataforma (unico) -- `ADMIN_EMAIL=... ADMIN_NAME="..." ADMIN_PASSWORD=... npm run create-admin`. So funciona se ainda nao existir nenhum |
| `npm run jobs:run` | Corre o pipeline de jobs em segundo plano uma vez, para todos os tenants ativos (ver `lib/jobsRunner.ts`) |

---

## Variaveis de Ambiente

| Variavel | Funcao | Default |
|----------|--------|---------|
| `DATABASE_URL` | URL de ligacao PostgreSQL | `postgresql://postgres:password@localhost:5432/portucale_dental` |
| `JWT_SECRET` | Chave de assinatura JWT | -- |
| `JWT_TTL_SECONDS` | Validade do token | `604800` (7 dias) |
| `R2_ENDPOINT` | Endpoint Cloudflare R2 | Opcional |
| `R2_BUCKET` | Bucket R2 | Opcional |
| `R2_ACCESS_KEY_ID` | Credenciais R2 | Opcional |
| `R2_SECRET_ACCESS_KEY` | Credenciais R2 | Opcional |
| `R2_PUBLIC_BASE_URL` | URL publica de uploads | Opcional |
| `TWILIO_ACCOUNT_SID` | Account SID Twilio (SMS) | Opcional |
| `TWILIO_AUTH_TOKEN` | Auth Token Twilio (SMS) | Opcional |
| `TWILIO_FROM_NUMBER` | Numero remetente Twilio (E.164) | Opcional |
| `ANTHROPIC_API_KEY` | Chave da API Claude para analise IA de relatorios | Opcional -- sem ela mostra "nao configurado" |
| `UPLOAD_RETENTION_DAYS` | Politica de retencao de ficheiros | 90 |

---

## Docker

Servicos disponiveis via `docker-compose.yml`:

| Servico | Imagem | Porta | Funcao |
|---------|--------|-------|--------|
| `postgres` | postgres:17-alpine | 5432 | Base de dados |
| `pgadmin` | dpage/pgadmin4:latest | 5050 | Interface de gestao da BD |
| `app` | Build customizado | 3000 | Aplicacao Next.js |
| `jobs` | Build customizado (stage `builder`) | — | Corre `scripts/run-jobs.ts` em loop (ver `JOB_INTERVAL_SECONDS`) — pipeline de lembretes, risco de no-show, reativacao de pacientes inativos, envio de notificacoes SMS, expiracao de ofertas de lista de espera, retencao de uploads e snapshot de recuperacao de receita, para todos os tenants ativos. Ver `lib/jobsRunner.ts`. |

---

## Padroes Arquitectonicos

1. **Validacao server-side**: Todas as rotas API validam inputs com `lib/validate.ts` e verificam permissoes com `lib/permissions.ts`
2. **Audit trail**: Cada mutacao passa por `appendAudit()` e `appendTimeline()` com hash SHA-256
3. **CSRF double-submit**: Cookie + token header em todas as mutacoes nao-GET
4. **Maquina de estados**: Transicoes de consulta validadas contra estados permitidos na BD
5. **Estado cliente**: React Context (`AuthProvider`) gere estado de auth e fornece helper `api()` centralizado com CSRF automatico
6. **Cache de configuracao**: Tabelas de referencia (codigos TANOMD, condicoes de dentes, estados) sao buscadas uma vez e cacheadas no contexto de auth
7. **Multi-tenancy**: Isolamento via `tenant_id` foreign keys, com bypass de admin para super admins

---

## Melhorias Futuras

| Area | Atual | Caminho de upgrade |
|------|-------|-------------------|
| Auth | JWT custom | NextAuth.js ou Clerk |
| Passwords | bcrypt | Manter (ja seguro) |
| Tempo real | Refetch apos acao | Pusher / Ably WebSockets |
| Notas clinicas | Texto plano | AES-256 com KMS por clinica |
| Rate limiting | Em memoria, por instancia | Redis ou equivalente, partilhado entre instancias |
| Deploy | localhost | Vercel (Edge) ou VPC privada |

---

## Licenca

Projecto privado -- Portucale Dental
