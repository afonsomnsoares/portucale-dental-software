# Portucale Dental

**Camada de operação e receita para clínicas dentárias.**
Next.js 16 · React 19 · TypeScript · PostgreSQL 17 · App Router · interface em pt-PT

---

## O que isto é

Uma PMS guarda o que aconteceu. **Esta camada decide o que deve acontecer a seguir.**

A diferença não é de vocabulário. Uma clínica com uma PMS bem preenchida continua a perder
dinheiro em sítios que a PMS regista fielmente e sobre os quais não diz nada: o plano de
5 000 € apresentado há três semanas e nunca respondido, a cadeira 2 com quatro horas vazias
na próxima terça, o doente que não volta há sete meses, a caixa de compósito que acaba a
meio de uma quinta-feira cheia. Está tudo lá dentro. Nada daquilo pergunta por si.

O que este produto faz é olhar para esses mesmos dados e produzir **a próxima ação**, com
um número ao lado e uma pessoa responsável por ela.

Concretamente, hoje, contra dados reais:

- diz onde está o dinheiro a escapar, repartido por **doze categorias quantificadas em
  euros** — orçamentos por aceitar, tratamentos parados, recalls vencidos, vagas por
  encher, saldos por cobrar;
- pontua o risco de falta de cada consulta futura e contacta preventivamente as que estão
  acima do limiar;
- transforma «a cadeira 2 está subutilizada» em «mover esta consulta para as 14:30 recupera
  45 minutos», com a consulta, o destino e o ganho;
- quando uma quebra aparece, não mostra só a quebra: **decompõe-a por segmento** e diz
  *«sobretudo Dr. Silva (58% da queda) e Cadeira 3 (24%)»*;
- projeta o consumo de material a partir das consultas já marcadas e prepara a encomenda;
- diz **quanto sobra** e não só quanto entrou — margem por dentista, por cadeira e por
  tratamento, com a base de imputação declarada ao lado do número;
- pontua cada doente em três eixos — envolvimento, risco de abandono e probabilidade de
  marcação — e ordena a lista de chamadas pelo produto dos dois últimos, que é a definição
  operacional de um telefonema que vale a pena;
- prevê que **lugar concreto** vai ficar vazio, distinguindo a falta que se perde do
  cancelamento que ainda se enche;
- atende quem responde: SMS e chamadas entram numa caixa de entrada, com o que é clínico
  a escalar sempre para uma pessoa;
- e impede que cinco agentes bem-intencionados enviem cinco SMS contraditórios ao mesmo
  doente no mesmo dia.

## O que isto deliberadamente não é

Fora de âmbito por decisão, não por falta de tempo. A régua completa — e as três regras
que nenhuma funcionalidade pode contornar — está em **[PRODUCT.md](PRODUCT.md)**.

| Fora | Porquê |
|------|--------|
| **Odontograma** | Decisão clínica e representação do estado da boca. Pertence à PMS. Existiu neste código e foi **removido** (migração 034) |
| **Faturação certificada** | O documento fiscal é emitido por software certificado da clínica. Aqui regista-se valor e conta corrente, nada mais |
| **Comparticipações e seguros** | Domínio próprio, com regras de terceiros que mudam sem aviso |
| **Imagiologia** | Aquisição, visualização e armazenamento de imagem médica |
| **Qualquer decisão clínica** | O software não propõe tratamento, não interpreta anamnese e não substitui julgamento profissional |

> **O teste, quando houver dúvida:** se uma funcionalidade se descrever bem como *«guardar
> o que aconteceu»*, pertence à PMS da clínica e não a nós. Se se descrever como *«decidir
> o que fazer a seguir»*, é nossa.

## A fronteira, e onde ela está sob pressão

O código contém hoje registo clínico — historial médico, notas com ditado por voz,
prescrições, encomendas de laboratório, consentimentos por procedimento, catálogo TANOMD.
Isso é, pela regra acima, *guardar o que aconteceu*.

Está aqui por uma razão prática: a camada precisa de ler estes sinais para decidir, e nem
toda a clínica tem uma PMS de onde os importar. **É uma superfície de registo mínima ao
serviço das decisões, não uma tentativa de substituir a PMS** — e é o ponto do produto que
mais merece vigilância, porque é por aqui que um produto destes se transforma, funcionalidade
a funcionalidade, naquilo que decidiu não ser.

Onde a fronteira já está desenhada e vale a pena não mexer: os documentos gerados são
**administrativos, sem qualquer conteúdo clínico, por desenho**; o otimizador de agenda
propõe e nunca aplica; nenhum agente fala com alguém de fora sem uma pessoa a clicar.

---

## Dimensão

| | |
|---|---|
| Rotas de API | 125 |
| Páginas de dashboard | 59 |
| Componentes | 71 |
| Módulos de lógica | 75 em `lib/` + 15 de agentes |
| Tabelas PostgreSQL | 68 |
| Migrações incrementais | 51 |
| Jobs em segundo plano | 29 por clínica + 1 de plataforma |
| Testes unitários | 543, em 36 ficheiros — sem base de dados |
| Testes de integração | 140, em 22 ficheiros — contra PostgreSQL real |

---

## Arranque rápido

```bash
# 1. Base de dados (PostgreSQL 17 + pgAdmin)
docker compose up -d postgres pgadmin

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
outros utilizadores nascem dentro do dashboard. **Não existe ecrã de auto-registo.**

### Credenciais demo

Criadas por `npm run db:seed -- --with-demo-users`. **Só para desenvolvimento — nunca em
produção.**

| Papel | Email | Password |
|-------|-------|----------|
| Super Admin | `admin@portucale.dental` | `admin123` |
| Rececionista | `rececao@portucale.dental` | `recep123` |
| Médico Dentista | `medico@portucale.dental` | `dent123` |

---

# As oito áreas

O produto organiza-se em oito áreas. Cada uma abaixo traz **o que está construído** e, sem
rodeios, **o que falta** — o estado real, mapeado ao código.

## 1 · 🧠 Inteligência do doente

O contexto que alimenta todas as outras áreas.

- **Perfil unificado** com campos RGPD, alertas médicos e campos dinâmicos por clínica
- **Timeline imutável**: cada mutação relevante escreve uma linha encadeada por hash
- **Histórico completo**: consultas, tratamentos, cancelamentos, faltas, pagamentos,
  documentos, consentimentos, interações registadas
- **Preferências de agendamento** guardadas no perfil, e **preferências de comunicação**
  que travam de facto o envio automático (`lib/commPrefs.ts`)
- **Jornada automática** (`lib/patientJourneyCalc.ts`): oito etapas, de marcação a nova
  consulta, com a etapa atual derivada dos sinais — nunca um campo guardado que possa
  dessincronizar
- **Ciclo de vida** (`lib/lifecycleCalc.ts`): novo, em tratamento, estável, desaparecido —
  com reativação automática por SMS para quem tem consentimento de marketing
- **Próxima ação** (`lib/nextAction.ts`): regras por ordem fixa de urgência. A ordem *é* a
  política
- **Briefing do dia** (`lib/dailyBriefing.ts`): os mesmos sinais, reduzidos a quem entra
  hoje pela porta

- **Três scorings contínuos** (`lib/patientScoringCalc.ts`), no molde de `lib/noShowRisk.ts`
  — pesos declarados, fatores normalizados, e a contribuição de cada um devolvida ao lado
  do número, para a UI poder explicar *porquê* em vez de mostrar um número nu:

  | | |
  |---|---|
  | **Envolvimento** | Quão presente é este doente — comparência, recência, resposta ao contacto, aceitação de planos, documentação e pagamentos |
  | **Risco de abandono** | Contínuo, com rampa dos 3 aos 18 meses. Substitui o degrau binário como sinal de prioridade; o modelo de 4 etapas mantém-se, porque é ele que governa a reativação automática |
  | **Probabilidade de marcação** | Se eu telefonar hoje, esta pessoa marca? Zero — com o motivo escrito — para quem não autoriza contacto ou já tem consulta marcada |

  Os dois primeiros são **independentes por construção**, e isso é o ponto: um doente pode
  ter envolvimento alto E risco alto ao mesmo tempo — era ótimo e está a desaparecer. É
  precisamente esse a quem vale a pena telefonar, e é exatamente esse que um estado binário
  só encontra seis meses tarde demais.

  A lista de chamadas ordena-se por **risco × probabilidade de marcação**, e não por risco:
  ordenar só por risco põe os casos perdidos no topo, que é onde o tempo se desperdiça.

> **Falta:** calibrar as fórmulas contra histórico real de uma clínica. Os pesos são
> plausíveis e explicáveis; não são medidos, e nenhum número neste ficheiro finge que são.

## 2 · 📅 Inteligência de agenda

A área mais desenvolvida do produto. O motor procura continuamente a combinação
**doente + dentista + cadeira + equipamento + duração + horário**.

- **Marcação assistida** (`lib/scheduling.ts`): tipos de consulta com duração própria,
  especialidade exigida (contra `users.specialties`) e equipamento exigido (contra as
  *tags* de `clinic_equipment`). Sem correspondência, sugere sem filtro e avisa — em vez de
  não devolver nada
- **Vista diária** estilo Google Calendar (07:00–17:00), blocos por cadeira, linha do
  "agora", avanço de estado num clique
- **Máquina de estados** validada no servidor; transições inválidas devolvem HTTP 400:

  ```
  confirmed/registered → waiting → in-operatory → procedure-active → ready-dismissal → departed
                                                                                     ↘ no-show
  ```
- **Lista de espera** completa: inscrição com preferências, motor de *matching*
  (`lib/waitlistMatch.ts`), oferta automática da vaga por SMS quando uma consulta cai,
  expiração das ofertas em 24h
- **Risco de falta** por consulta futura, persistido em `appointments.risk_score`, com
  *outreach* proativo distinto do lembrete normal acima de 60
- **Métricas de eficiência**: ocupação por cadeira e por dentista, fragmentação,
  cancelamentos de última hora
- **Otimizador** (`lib/scheduleOptimizerCalc.ts`): passa do diagnóstico à proposta concreta,
  com a consulta, o destino e os minutos recuperados. Quatro regras — encaixe em espaço
  livre, consulta sem dentista, libertação de cadeira com equipamento único, e consulta que
  contraria as preferências do doente
- **Seis previsões** (`lib/forecast.ts`): receita, ocupação, procura, cancelamentos, faltas
  e capacidade livre

> **Fronteira, não lacuna:** o otimizador é **read-only por desenho**. Propõe, nunca aplica
> — mover uma consulta obriga a avisar o doente, e essa decisão é de quem atende. A exceção
> é a lista de espera, onde a oferta de uma vaga sai sozinha porque não prejudica ninguém.
>
- **Raciocínio sobre duas ou mais consultas** — as três regras que faltavam ao otimizador:

  | | |
  |---|---|
  | **Agrupar** | Consultas do mesmo doente em dias próximos que cabem numa sessão. Poupa tempo de rotação, poupa uma deslocação e — o que costuma esquecer-se — **remove uma oportunidade de faltar**: duas consultas são duas hipóteses de não aparecer, uma é uma |
  | **Antecipar** | Consulta marcada para longe com espaço livre mais cedo. Não cria capacidade (troca um lugar por outro), por isso o ganho declara-se em **dias** e não em minutos — mas o prazo de marcação é ele próprio um fator de risco de falta |
  | **Combinar** | Duas consultas do mesmo dia com um buraco entre elas. Não muda quanto tempo se usa; muda **onde fica o tempo livre** — de trinta minutos mortos a meio da manhã para um bloco contíguo na ponta, que é o único que se consegue vender a uma consulta inteira |

- **Previsão de slot vazio, ao nível do slot** (`lib/slotRiskCalc.ts`). As seis previsões
  acima são do dia — chegam para planear pessoal e não chegam para mais nada: ninguém pode
  contactar a lista de espera para «4 faltas». Isto desce ao lugar concreto, e faz a
  distinção que interessa:

  ```
  P(fica vazio) = P(esvazia) × [ P(é falta) + P(é cancelamento) × P(não se enche) ]
  ```

  Uma falta descobre-se à hora e é tempo perdido; um cancelamento avisado é tempo
  **recuperável**, se houver a quem oferecê-lo. Somar as duas coisas num único «risco» é o
  erro que este módulo existe para não cometer: uma clínica com muitos cancelamentos
  antecipados e lista de espera cheia não tem problema nenhum, e uma com metade das faltas
  e nenhuma lista de espera tem.

## 3 · 📞 Comunicação com o doente

Era a área mais incompleta do produto: o sistema enviava e não conversava. Um doente que
respondesse «podem mudar para a semana seguinte?» estava a falar com uma parede.

Construído:

- **Envio por SMS** via API REST da Twilio, com fila, *retry* agendado e degradação suave
  sem credenciais
- **Saída única**: todo o envio automático passa pelo job `send`, num só sítio, onde vive a
  política de consentimento, canal preferido e deduplicação
- **Comunicação proativa**: confirmações, lembretes, recall, follow-up de planos,
  reativação, ofertas de vaga
- **Portal do doente sem login**: link de uso único (token guardado apenas em hash) onde o
  doente completa dados em falta, envia um documento pedido ou assina um consentimento. A
  recolha é *self-service*; a validação continua a ser um passo humano, criado como tarefa
- **Captação externa**: cada site ou landing page recebe um bearer token próprio e cria
  leads sem sessão de pessoal

- **Canal de entrada** (`lib/conversationCalc.ts`, `lib/inbound.ts`, migração 049):

  - **Webhook por canal** (`/api/webhooks/[channel]`) — **SMS e chamada, e mais nada.**
    Cada canal a mais é uma superfície de ataque, uma conta de terceiros a manter e um
    caminho de código que ninguém exercita; o WhatsApp Business acrescenta ainda
    verificação Meta e templates aprovados. Dois canais que funcionam valem mais do que
    cinco por ligar (migração 052).
    É a rota mais exposta da aplicação, e por isso: a clínica é resolvida a partir do
    **endereço de destino** e nunca de um parâmetro do pedido (um `tenantId` no corpo
    seria um seletor de clínica oferecido a quem chama); a assinatura é obrigatória e
    comparada em tempo constante; uma conta sem segredo configurado é **recusada**, porque
    um webhook que aceita tudo é pior do que um que não existe; e a mensagem é
    deduplicada pelo id do fornecedor, que reenvia o que não recebe 200 a tempo
  - **Estado de conversa** com máquina de estados validada no servidor. A caixa de entrada
    separa o que espera por *nós* do que espera pelo *doente* — uma caixa que misture as
    duas é uma caixa que ninguém consegue esvaziar
  - **Roteamento de intenções** determinístico, em pt-PT, com termos fortes e ambíguos
    declarados: só um termo inequívoco autoriza uma resposta automática
  - **Escalamento com contexto**: quem chega a meio de uma conversa recebe o resumo — quem
    é a pessoa, o que já lhe foi dito automaticamente, o que está pendente — em vez de ter
    de reconstruir. Mesma ideia da passagem de turno
  - **Varredura de conversas esquecidas**: uma conversa sem resposta é pior do que uma
    chamada não atendida, porque o doente já sabe que a mensagem chegou

- **Quatro degraus de autonomia**, por clínica, com o valor de repouso em `off`:

  | | |
  |---|---|
  | `off` | Tudo vai para uma pessoa. **É o comportamento por omissão** |
  | `acknowledge` | Só «recebemos a sua mensagem» |
  | `informational` | Responde a factos verificáveis — horário, morada — a partir de texto que uma **pessoa** escreveu, nunca gerado. **Só por SMS** |
  | `transactional` | Além disso, regista confirmações e cancelamentos e propõe alternativas |

> **Duas regras não dependem do degrau, em degrau nenhum**, e é isso que torna a escada
> segura de subir:
>
> - **qualquer assunto clínico escala** — dor, inchaço, sangramento, um dente partido —
>   sem resposta automática. É a fronteira do produto inteiro, e é aqui que seria mais
>   fácil atravessá-la sem dar por isso: um modelo responde a «dói-me muito» com uma
>   frase simpática sem hesitar nenhuma;
> - **um pedido para não ser contactado é sempre processado**, e escrito no perfil do
>   doente e não só na conversa. Não é uma funcionalidade, é obrigação legal.
>
> Preços nunca são respondidos automaticamente em nenhum degrau: um preço depende do caso,
> e um número errado dito por escrito por uma clínica é um compromisso que ela vai ter de
> honrar.
>
> **Uma chamada nunca recebe resposta automática, em nenhum degrau.** Não é uma limitação
> à espera de ser levantada — é o que «chamada» significa: responder a uma chamada é
> falar, e falar é uma pessoa. O que entra por voz é a transcrição do que alguém disse ao
> telefone; o sistema classifica-a e põe-na na caixa de entrada de quem vai ligar de
> volta. A escada de autonomia aplica-se só ao SMS.
>
> **Falta:** ligar os dois canais na Twilio (número de voz com transcrição, número de
> SMS) — conta e configuração, não código. E falta a decisão de produto de subir da
> posição `off`, que é de quem responde pela clínica.

## 4 · 💰 Recuperação de receita

Responde a uma pergunta só: **onde está o dinheiro que a clínica está a deixar escapar?**

`lib/recovery.ts` devolve **doze categorias, cada uma quantificada em euros**:

| | |
|---|---|
| Orçamentos não aceites | Planos apresentados |
| Tratamentos abandonados | Planos por iniciar |
| Recalls atrasados | Pacientes inativos (> 6 meses) |
| Registados sem marcação | No-shows (90 dias) |
| Consultas canceladas (90 dias) | Leads sem marcação |
| Slots vazios | Saldos por cobrar |

E acompanha o funil inteiro — **lead → contacto → marcação → consulta → plano → aceitação →
tratamento** — com origem de captação, conversão em doente (por correspondência de telefone)
e triagem de leads por IA que escreve o rascunho da resposta.

*Snapshots* periódicos guardam a evolução, para que a recuperação se possa medir e não
apenas listar.

## 5 · 📊 Inteligência de gestão

Deixa de olhar para um doente e passa a olhar para a clínica inteira.

- **Previsão** das seis métricas (ver área 2), com horizonte configurável
- **Desempenho**: receita por dentista, por cadeira e por hora; ocupação, conversão,
  retenção, faltas, cancelamentos
- **Comparação entre clínicas** do grupo, ao nível da plataforma
- **Deteção de anomalias** (`lib/anomaly.ts`, `lib/anomalyCalc.ts`) — determinística, **sem
  IA**. E não se fica pelo problema: decompõe a variação pelos segmentos que a produziram
  (dentista, cadeira, tratamento, dia da semana) e devolve os que mais pesaram, até cobrir a
  maior parte do desvio:

  > *«sobretudo Dr. Silva (58% da queda) e Cadeira 3 (24%).»*

- **Diagnóstico por IA** (Claude) a partir das métricas já calculadas, que degrada com
  elegância sem `ANTHROPIC_API_KEY`

## 6 · ⚙️ Operações da clínica

Tudo o que acontece por trás do doente. A ideia: a clínica não gere o *workflow* à mão — o
sistema coordena-o.

- **Checklists** por clínica, com corridas do dia e lembretes automáticos (abertura,
  encerramento)
- **Incidentes** com escalamento automático para a direção quando ficam por resolver
- **Passagem de turno**: rascunho pré-preenchido a partir do estado real da clínica —
  doentes ainda no espaço, tarefas abertas, incidentes por fechar, checklists por concluir,
  ofertas sem resposta. Guardada **congelada como texto** (uma passagem é o que foi dito
  naquele momento, não uma vista que se recalcula), com confirmação de leitura pelo turno
  seguinte; **quem escreve não pode confirmar a própria passagem**
- **Distribuição automática de tarefas** (`lib/taskRoutingCalc.ts`): cruza papel elegível,
  quem está de turno agora, quem não está de férias e quem tem menos tarefas abertas.
  Determinista, com desempate por nome. O filtro de papel é **estrito e sem fallback** — sem
  rececionista disponível a tarefa fica na fila partilhada em vez de cair num clínico — e
  uma escolha humana explícita nunca é contrariada
- **Horários, férias e cobertura** da equipa

- **Encadeamento pré e pós-consulta** (`lib/carePathwayCalc.ts`, migração 048): um percurso
  por tipo de consulta, com passos datados relativamente à consulta —
  *«implante daqui a 3 dias → gerar consentimento, confirmar jejum, verificar dados em
  falta»*. Segue o padrão que `procedure_item_usage` já usava para material, aplicado a
  trabalho em vez de a consumíveis.

  **Não existe tabela de execuções, e isso é a decisão central.** A tentação óbvia era uma
  terceira tabela a marcar cada passo como pendente/feito; um registo paralelo de progresso
  dessincroniza-se no dia em que alguém assina um consentimento pelo caminho normal, e
  passa a haver duas verdades sobre a mesma coisa. Em vez disso, um passo é **devido
  enquanto a prova de que está satisfeito não existir** — o motor pergunta sempre à
  realidade. Consequência prática: pode correr de hora a hora sem duplicar nada, e uma
  clínica que faça o trabalho por fora vê os passos desaparecerem sozinhos.

  Um passo pós-consulta só se aplica a uma consulta **realizada**: gerar «marcar controlo
  aos 6 meses» para quem faltou é produzir trabalho a partir de uma coisa que não
  aconteceu, e é esse tipo de ruído que faz uma equipa deixar de olhar para a lista.

> **Falta:** a lista de passos de cada tipo de consulta. O motor está construído; o que lá
> vai dentro é protocolo da clínica, não do software.

## 7 · 📦 Inventário e financeiro

**Inventário — praticamente completo:**

- Catálogo global com **ponto de reposição por clínica** (uma clínica com três cadeiras e
  outra com doze não repõem no mesmo ponto)
- Stock por clínica, lotes com validade, movimentos, consumo por procedimento
- **Consumo FEFO** (*first-expired-first-out*) e alertas de expiração
- **Previsão a partir da agenda**: `procedure_item_usage` liga tipo de consulta a consumo,
  e a previsão projeta o que vai ser preciso — *«com base nas consultas dos próximos 14
  dias, vamos precisar de X»*
- **Fornecedores e encomendas** com aprovação e receção. O rascunho de reposição pode ser
  decidido pela IA, mas **nunca sai de `draft` sozinho**
- **Equipamento** com plano e lembretes de manutenção

**Financeiro:**

- Faturação interna com linhas de item, pagamentos parciais, métodos (Multibanco, seguro,
  numerário) e saldo em dívida
- Faturas ligadas à consulta que as gerou
- Receita por dentista, cadeira, tratamento e hora; previsão; perdas; anomalias; pendentes

> **Esta plataforma não processa pagamentos nem emite documentos fiscais.** Regista o valor
> e a conta corrente do doente; a fatura legal é emitida pelo software certificado da
> clínica.
>
**Custos e margem** (`lib/costingCalc.ts`, migração 047) — a lacuna que impedia metade do
financeiro de existir. Até aqui havia **uma** coluna de custo em toda a base de dados
(`equipment_maintenance.cost`): «receita por dentista», «por cadeira» e «por tratamento»
diziam quanto entrou e nunca quanto sobrou, e a cadeira que mais fatura pode ser a que
menos dá.

- Preço de catálogo com **override por clínica** (mesmo padrão do ponto de reposição: o
  produto é o mesmo em todo o lado, o preço negociado não é), custo no lote à receção, e
  custo médio ponderado para debitar consumos
- Custo de material por tipo de consulta a partir de `procedure_item_usage` — a ligação já
  existia para prever compras, faltava-lhe o preço
- **Duas margens, e a distinção não é cosmética:** *contribuição* (receita − material − mão
  de obra) e *líquida* (menos o custo fixo imputado). Um tratamento com contribuição
  positiva e margem líquida negativa é exatamente a informação que faltava
- Acompanha sempre a **cobertura**: «78% dos consumos têm custo registado». Uma margem
  calculada sobre metade dos itens sem preço é pior do que inútil — parece boa

> **A imputação do custo fixo é uma definição por clínica, não uma constante no código.**
> Somar custo direto é aritmética; imputar custo fixo é contabilidade — a mesma clínica com
> os mesmos números dá margens diferentes conforme a base, e nenhuma está «certa». Três
> métodos: `direct_only` (não imputa; dá margem de contribuição, que é uma resposta honesta
> e não uma resposta em falta), `per_chair_hour` (por omissão) e `per_appointment`.
>
> `per_chair_hour` reparte pelas horas de cadeira **ocupadas** e não disponíveis, de
> propósito: com base nas disponíveis, uma clínica a metade da ocupação veria a margem de
> cada tratamento intacta e a perda escondida numa linha de «capacidade não utilizada» que
> ninguém lê. Com base nas ocupadas, ocupar menos torna cada hora ocupada mais cara, e a
> margem diz a verdade sobre o mês que a clínica teve.

**Produtos parados** — o contrário da rutura, e o mais fácil de ignorar: material que está
lá, custou dinheiro e não sai. Quatro casos distintos, porque tratá-los como um só é o que
torna a lista inútil: *nunca consumido* (engano de compra), *parado* (mudou o protocolo),
*rotação lenta* (não é erro, é excesso) e *parado e a expirar* — que não é um aviso, é uma
perda com data marcada. Com o capital imobilizado ao lado, e `null` em vez de 0 € quando o
item não tem preço: «não sabemos quanto vale» é diferente de «não vale nada».

**Reconciliação de encomendas** — uma encomenda tem três versões de si própria e só por
acaso coincidem: o que se **pediu**, o que **chegou** e o que se **pagou**. Marcar como
recebida, que era tudo o que o sistema fazia, assume que as três são a mesma; na prática o
fornecedor manda 8 das 10 caixas, sobe o preço unitário sem avisar, ou junta um item que
ninguém pediu. Nada disso dava erro em lado nenhum — entrava no stock como verdade e a
diferença descobria-se meses depois. A reconciliação é **congelada** quando se conclui, e
não recalculada: é o que se concluiu naquele momento, não uma vista que muda sozinha
quando alguém corrige o stock três semanas depois.

## 8 · 🤖 A camada de agentes

Não um agente de agendamento. **Um sistema de agentes coordenados**, cada um com um domínio,
uma fronteira explícita e o conjunto de jobs que já governa.

O ponto importante: **nenhum agente é trabalho novo a inventar** — são jobs determinísticos
que já corriam, agrupados por quem decide o quê. O catálogo é só dados (sem BD, sem IA), por
isso testa-se sem Postgres.

| Agente | Domínio | Fronteira |
|--------|---------|-----------|
| 📞 **Lead** | Do primeiro contacto até virar doente: qualifica a intenção e escreve o rascunho da resposta | Nunca envia sozinho — falar com alguém de fora exige uma pessoa a clicar |
| 👤 **Doente** | Contexto do doente e próxima ação: planos por aceitar, recall, reativação | Coordena; não pratica atos clínicos nem decide tratamento |
| 📅 **Agenda** | Encaixa procura nos recursos: cadeiras, especialidade, lista de espera, risco de falta | Agenda de doentes; turnos e férias são de Operações |
| 💳 **Finanças** | Dinheiro já faturado: cobrança, pendentes, saldo em dívida | Antes da fatura existir, o assunto é do Doente/Lead |
| ⚙️ **Operações** | Checklists, incidentes, passagem de turno, stock, reposição, manutenção | A IA decide o rascunho de encomenda, mas nunca sai de `draft` |
| 📊 **Gestão** | Compara períodos, identifica o desvio, explica a causa provável e quantifica a perda | Diagnostica e quantifica — não age |
| 🏥 **Grupo** | Compara as clínicas do grupo entre si | Só ao nível da plataforma: os insights ficam com `tenant_id NULL` e só o super-admin os vê |
| 🔐 **Conformidade** | RGPD, retenção e auditoria: prazos vencidos e pedidos do titular | Prepara e sinaliza — nunca apaga |

**A comunicação não é um agente**: é o canal por onde todos passam, e por isso a política
vive num sítio só, com o job `send` como saída única.

### Coordenação: o que faltava para «agentes coordenados» ser verdade

A política que vivia nesse sítio era metade: consentimento e deduplicação **por tipo de
mensagem**. Deduplicação por tipo impede dois lembretes para a mesma consulta e não impede
nada entre agentes. Na prática, um doente com uma consulta amanhã, um plano por responder,
um recall vencido e seis meses sem vir recebia, **na mesma passagem do cron**:

```
reminders           «lembramos da sua consulta amanhã»
riskOutreach        «confirma a sua consulta?»
planFollowup        «o seu plano continua disponível»
recallOutreach      «está na altura de marcar a sua higiene»
lifecycleOutreach   «já não o vemos há algum tempo»
```

Cinco SMS da mesma clínica no mesmo dia, dois deles a contradizerem-se — o quinto diz que
não o vêem há muito a quem o primeiro lembra de vir amanhã. **Cada agente estava certo
isoladamente.**

Hoje nenhum agente escreve em `notifications`. Todos **pedem**, e o árbitro
(`lib/agents/coordinationCalc.ts`) decide uma vez por passagem, com todos os pedidos à
vista — um árbitro que veja um pedido de cada vez não é um árbitro, é uma fila.

- **Prioridade pelo que se perde por esperar, não por euros.** Uma vaga de lista de espera
  expira em 24h; um lembrete tem data; uma reativação pode sair na próxima terça e nada
  acontece. Por isso o lembrete de uma higiene de 45 € ganha a um plano de 5 000 €: falhar
  o lembrete estraga uma consulta já marcada, adiar o plano custa um dia
- **Quem perde é diferido, não descartado** — a razão que tinha não desapareceu, volta a
  pedir amanhã. A única recusa definitiva vem da vontade do doente
- **Coerência antes de orçamento**: uma reativação para quem tem consulta marcada não é
  excesso de contacto, é a clínica a dizer ao doente que não sabe quem ele é. E é recusada
  primeiro, para não gastar a quota do dia a uma mensagem correta
- **Contexto partilhado**: um snapshot por doente, lido por todos. Não é cache por
  desempenho — é por **consistência**: dois agentes a decidir sobre o mesmo doente têm de
  decidir sobre os mesmos factos, senão a arbitragem compara coisas incomparáveis
- **Cada cedência fica escrita** em `agent_contact_ledger`, com o motivo em português. Um
  árbitro em que ninguém vê quem cedeu a quem é um árbitro em que ninguém confia — e a
  primeira pergunta de uma clínica quando um SMS não sai é exatamente essa

Os efeitos colaterais passaram a acontecer só para as mensagens que saíram mesmo. Marcar a
reativação como enviada antes da decisão punia o doente pelo contacto que **não** recebeu:
o *cooldown* de 30 dias arrancava na tentativa em vez de no envio.

**Onde a IA entra hoje, em concreto** — e só aqui:

- `reorderAgent` decide o rascunho de reposição de stock. Sem chave, cai para a regra fixa.
  A IA só pode escolher itens que já estavam na lista de candidatos e pedir no máximo o
  dobro da quantidade que a regra determinística sugeria — nunca inventar um item nem
  disparar uma encomenda por uma alucinação de quantidade
- `leadAgent` qualifica leads novos e escreve o rascunho da resposta. Sem chave, não faz
  triagem (não há regra fixa equivalente)
- os agentes de análise escrevem *insights* em `agent_insights`, substituindo em cada corrida
  os que ainda estão por tratar e preservando o histórico dos já resolvidos

> **Autonomia é deliberadamente parcial.** Tudo o que sai da clínica para uma pessoa de fora,
> e tudo o que é irreversível, exige um humano. Os agentes preparam; não executam.

---

## Jobs em segundo plano

Pipeline central em `lib/jobsRunner.ts`, corrido por `scripts/run-jobs.ts` (cron ou o serviço
`jobs` do Docker Compose) ou sob pedido de um admin. 29 jobs por clínica, mais `groupReview`,
que corre uma vez por passagem porque é transversal às clínicas:

| Grupo | Jobs |
|-------|------|
| Agenda | `reminders`, `risk`, `riskOutreach`, `waitlistExpire`, `scheduleReview` |
| Doente | `assignTasks`, `planFollowup`, `recallOutreach`, `lifecycleOutreach`, `patientReview`, `carePathways` |
| Lead | `leadTriage`, `leadFollowup`, `leadSourceReview` |
| Finanças | `summary`, `recovery`, `financeReview` |
| Operações | `escalateIncidents`, `checklistReminders`, `handoffReminders`, `reorderSuggestions`, `equipmentMaintenance`, `conversationSweep` |
| Gestão/Grupo | `managementReview`, `anomalyReview`, `groupReview` |
| Conformidade | `retention`, `retentionPolicies` |
| Comunicação | `send` |

As tarefas de comunicação (`reminders`, `riskOutreach`, `recallOutreach`,
`lifecycleOutreach`, `planFollowup`) **já não enviam nada**: devolvem pedidos, e a
arbitragem corre uma vez no fim da passagem — ver a secção de coordenação na área 8.

Cada execução fica registada em `job_runs` (com `tenant_id NULL` para os jobs de plataforma)
e no `audit_log`. Sem credenciais da Twilio o envio degrada com elegância — fica em fila com
retry agendado, sem rebentar o pipeline.

---

## Papéis e permissões

Quatro papéis, com árvores de dashboard separadas (`proxy.ts` → `DASHBOARD_ACCESS`):

| Papel | Âmbito | Acesso |
|-------|--------|--------|
| **Super Admin** | Plataforma (`tenant_id NULL`) | Clínicas, utilizadores, esquema, permissões, auditoria, comparação entre clínicas do grupo |
| **Admin** | Uma clínica | Tudo dentro da sua clínica: finanças, relatórios, operações, equipa, inventário, permissões |
| **Rececionista** | Uma clínica | Doentes, leads, agenda, tratamentos, faturação, sala de espera, recalls, tarefas, documentos |
| **Dentista** | Uma clínica | Processo clínico, historial médico, prescrições, laboratório, planos, consentimentos, notas |

O que uma rota verifica **não é o papel — é uma ação** (`prescriptions:manage`,
`documents:generate`, `incidents:report`, …). Os defaults seguem o princípio do mínimo
privilégio, e as ações novas seguem-no também: ler a margem vai à boleia de `finance:read`,
mas **escrever a base de imputação** (`costs:manage`) fica com a direção, porque muda o
número que toda a gente lê, em todos os relatórios e retroativamente; a caixa de entrada é
trabalho de balcão (`conversations:read`/`:reply` para a receção, só leitura para o
clínico, que é quem recebe os assuntos escalados), mas **mudar o nível de autonomia**
(`conversations:configure`) não é — é a decisão mais consequente que uma clínica toma
nesta aplicação. Cada clínica pode sobrepor qualquer combinação papel/ação em `role_permissions`,
pela UI de permissões — os defaults só valem onde não houver override. Ver `lib/permissions.ts`.

O super-admin **entra** numa clínica (cookie posto por `POST /api/tenants/enter`) e usa as
páginas do próprio admin, em vez de ter páginas espelhadas com um seletor de clínica em
estado local.

---

## Segurança e isolamento entre clínicas

- **Sessão**: JWT próprio (HMAC-SHA256) em cookie `httpOnly`, com rotação de chaves —
  `JWT_SECRET` assina, `JWT_SECRETS` lista segredos antigos que ainda validam, para que uma
  rotação não expulse quem tem sessão aberta.
- **Uma rota não pode esquecer-se de autorizar.** Os 191 handlers de `app/api/` passam por
  `withRoute` (`lib/route.ts`), que faz o preâmbulo inteiro — origem/CSRF, autenticação,
  revalidação de sessão, autorização, teto de escrita e resolução de clínica. As opções são
  uma união discriminada de quatro regimes (`permission`, `platform`, `authOnly`, `public`),
  por isso uma rota que não declare em qual vive **não compila**. As três exceções que
  recebem tráfego sem cookie de sessão — captação de leads, webhooks de canal e portal do
  doente — declaram-no com `crossOrigin: true`, e encontram-se com um grep.
- **A autorização segue a base de dados, não o token.** `revalidateSession` confronta cada
  pedido com `users`: conta apagada, desativada, movida de clínica ou despromovida perde
  acesso **no pedido seguinte**, não daí a uma semana. Mudar a password invalida os tokens
  emitidos antes dela (`users.password_changed_at`, mantido por trigger — migração 046).
- **Passwords**: bcrypt. O login não distingue "email inexistente" de "password errada", nem
  no corpo nem no tempo de resposta (coberto por `test/integration/login-oracle.test.ts`).
- **CSRF**: double-submit cookie com comparação em tempo constante + verificação de origem
  em todas as mutações.
- **Rate limiting em duas camadas**: o teto genérico sobre `/api/*` vive no proxy Edge (240
  pedidos/min por utilizador autenticado, 60/min por IP anónimo) e conta em memória, por
  instância — é a primeira linha, não o teto. Por cima dele, **todas as mutações** passam por
  um contador partilhado em Postgres (120/min por utilizador, `lib/rateLimitGlobal.ts`), que
  vale entre réplicas. O limite do **login** é diferente ainda: vive em `rate_limit_counters`
  (`lib/rateLimitShared.ts`), porque é um controlo de segurança e não pode depender de qual
  réplica atendeu o pedido.
- **Isolamento multi-clínica em duas camadas independentes**: filtros `tenant_id` na
  aplicação **e** políticas de Row-Level Security no próprio PostgreSQL (migração 011). Isto
  só funciona se a app ligar com `APP_DATABASE_URL` (papel `portucale_app`, não-superuser):
  um superuser ignora RLS incondicionalmente, e por isso `lib/db.ts` **recusa arrancar** sem
  essa variável quando `NODE_ENV=production`. Sem contexto de sessão, a sentinela falha
  fechada — a query vê zero linhas em vez de todas.
- **Cobertura de RLS testada**: `test/integration/rls-coverage.test.ts` falha se alguma
  tabela com `tenant_id` ficar sem política.
- **Auditoria à prova de adulteração**: `audit_log` e `patient_timeline` são append-only a
  nível de base de dados (`REVOKE UPDATE, DELETE`) e o hash de cada linha é calculado num
  trigger `BEFORE INSERT` que a encadeia à anterior — `sha256(prev_hash || campos)`. Alterar
  ou apagar uma linha parte a cadeia daí para a frente, de forma detetável (migração 015).
- **Uploads**: lista branca de quatro tipos, tamanho máximo, e **a extensão gravada deriva
  sempre do content type validado, nunca do nome do ficheiro** — o mesmo caminho para o
  upload multipart e para o PUT direto ao R2 (`lib/uploadsCalc.ts`). Um ficheiro sem content
  type declarado é recusado.
- **Cabeçalhos**: CSP com `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'none'`; HSTS com `preload`; `nosniff`;
  `X-Frame-Options: DENY`; Referrer-Policy; Permissions-Policy.
- **Rotas públicas**: existem exatamente duas rotas sem sessão, ambas autenticadas por
  bearer token em vez de cookie — captação externa de leads (`/api/public/leads`, a única
  com CORS aberto, sem credenciais) e o portal do doente
  (`/api/public/patient-portal/[token]`).

---

## Modelo de dados

68 tabelas, definidas em `scripts/schema.sql` e evoluídas por 51 migrações aplicadas por
ordem de nome e registadas em `schema_migrations`.

| Domínio | Tabelas |
|---------|---------|
| Plataforma | `tenants`, `users`, `role_permissions`, `schema_fields`, `audit_log`, `job_runs`, `rate_limit_counters` |
| Doentes | `patients`, `patient_alerts`, `patient_timeline`, `medical_history`, `patient_interactions`, `patient_tasks`, `patient_lifecycle_state`, `patient_scheduling_prefs`, `patient_portal_tokens`, `uploads` |
| Agenda | `appointments`, `appointment_cancellations`, `statuses`, `waitlist_entries`, `slot_offers` |
| Clínico | `treatments`, `treatment_codes`, `treatment_plans`, `prescriptions`, `lab_orders`, `recalls`, `consent_forms` |
| Financeiro | `invoices`, `recovery_snapshots`, `tenant_cost_settings` |
| Aquisição | `leads`, `lead_capture_sources` |
| Operações | `checklist_templates`, `checklist_runs`, `incidents`, `shift_handoffs`, `staff_schedules`, `staff_time_off`, `care_pathway_templates`, `care_pathway_steps` |
| Inventário | `inventory_items`, `inventory_item_settings`, `inventory_stock`, `inventory_batches`, `inventory_movements`, `procedure_item_usage`, `suppliers`, `purchase_orders`, `purchase_order_items` |
| Equipamento | `clinic_equipment`, `equipment_maintenance` |
| Documentos | `document_templates`, `generated_documents` |
| Agentes | `agent_insights`, `agent_contact_ledger` |
| RGPD | `patient_data_consents`, `data_subject_requests`, `processing_activities`, `data_retention_policies`, `dpo_contacts`, `privacy_notices` |
| Comunicação | `notifications`, `channel_accounts`, `conversations`, `conversation_messages`, `tenant_comms_settings` |

**Catálogos por clínica.** `treatment_codes`, `statuses` e `inventory_item_settings` (agora
também com o preço de custo) seguem a mesma convenção: `tenant_id NULL` é o catálogo global instalado pelo seed, e uma linha com
`tenant_id` é o override dessa clínica. Cada clínica sobrepõe só o que quer mudar — não há
cópia por clínica do catálogo inteiro.

**Campos dinâmicos.** Campos definidos pelo admin (string, boolean, integer, decimal, enum,
uuid_ref), aplicáveis por clínica ou globalmente, com percentagem de rollout e
obrigatoriedade.

---

## RGPD

O que está de facto implementado, e não apenas previsto no schema:

- **Consentimentos** (`patient_data_consents`) verificados antes de qualquer contacto
  automático de marketing/reativação
- **Direitos do titular** (`lib/dataSubject.ts`, artigos 15.º a 20.º): pedidos registados,
  exportáveis e cumpríveis. Toda a tabela com coluna `patient_id` tem de declarar aqui o que
  lhe acontece num pedido de acesso ou apagamento — e
  `test/integration/data-subject-coverage.test.ts` compara essa lista com o catálogo do
  Postgres e **falha** se alguém acrescentar uma tabela ligada a um doente sem decidir
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
npm run test              # 543 unitários, 36 ficheiros — sem base de dados
npm run test:integration  # 140 de integração, 22 ficheiros — precisa do PostgreSQL de .env.test
npm run test:all
```

Os unitários cobrem a lógica pura (`lib/*Calc.ts` e afins): risco de falta, scorings do
doente, previsão de slot vazio, matching de lista de espera, otimizador de agenda,
percursos de consulta, coordenação entre agentes, roteamento de mensagens recebidas, custo
e margem, produtos parados e reconciliação, distribuição de tarefas, disponibilidade de
pessoal, previsão de inventário, validação de uploads, permissões, agentes.

Os de integração correm contra um PostgreSQL real e cobrem os invariantes que só existem lá:
isolamento entre clínicas, cobertura de RLS, cobertura de tabelas ligadas ao doente para
efeitos de RGPD, revalidação de sessão, limite de login partilhado, a ausência de oráculo
no login, a autenticação dos webhooks de entrada e a arbitragem de contactos entre agentes.

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
| `ANTHROPIC_API_KEY` | IA: análise de relatórios, agente Operações (reposição) e agente Lead (triagem) | Opcional — cada um degrada à sua maneira |
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
| `jobs` | Build (stage `builder`) | — | Corre `scripts/run-jobs.ts` em ciclo. Usa deliberadamente a ligação admin: lê através de todas as clínicas, sem sessão que o delimite |

`POSTGRES_APP_PASSWORD`, `PGADMIN_PASSWORD` e `JWT_SECRET` são obrigatórias — o Compose
recusa arrancar sem elas.

> **Porque existe um serviço só para migrar.** O `initdb` do Postgres aplica apenas
> `scripts/schema.sql`, que define cerca de metade das tabelas: `patients`, `patient_tasks`,
> `inventory_items`, `suppliers`, `shift_handoffs` e mais duas dezenas nascem das migrações
> em `scripts/migrations/`. Sem o serviço `migrate`, `docker compose up -d` levantava uma app
> que arranca e serve tráfego, e falha em quase todas as páginas por tabelas que não existem.
> `scripts/migrate.ts` corre tudo numa transação única com `ROLLBACK` em erro e salta o que já
> está em `schema_migrations`, por isso repetir o `up` é um no-op.

O Compose não semeia dados. Depois do primeiro `up`, criar o super admin uma vez:

```bash
docker compose run --rm \
  -e ADMIN_EMAIL=... -e ADMIN_NAME="..." -e ADMIN_PASSWORD=... \
  migrate node --import tsx scripts/create-admin.ts
```

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
| Voz | Web Speech API | Nativo | Ditado (pt-PT) |
| Auth | JWT próprio + bcrypt | HMAC-SHA256 | Sessão em cookie + CSRF |
| IA | @anthropic-ai/sdk (Claude) | ^0.120.0 | Agentes e análise de relatórios |
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
├── PRODUCT.md                 ← Âmbito: o que pertence aqui e o que não
├── scripts/
│   ├── schema.sql             ← Schema base PostgreSQL
│   ├── migrations/            ← 51 migrações incrementais
│   ├── seed.ts                ← Dados demo (clínica, utilizadores, doentes, catálogos)
│   ├── migrate.ts             ← Runner de migrações (tabela schema_migrations)
│   ├── run-jobs.ts            ← Pipeline de jobs, para todas as clínicas ativas
│   ├── create-admin.ts        ← Criação única do super admin da plataforma
│   └── check-dburl.ts         ← Diagnóstico de DATABASE_URL
│
├── lib/                       ← Regra de negócio (75 módulos + 15 de agentes)
│   ├── db.ts                  ← Pool singleton, contexto de tenant para RLS
│   ├── auth.ts / jwt-edge.ts  ← JWT (Node e Edge), CSRF, sessão
│   ├── permissions.ts         ← ~70 ações, defaults por papel + override por clínica
│   ├── audit.ts               ← audit_log e patient_timeline (cadeia de hashes)
│   ├── tenantGuard.ts         ← Verificação de pertença à clínica
│   ├── rateLimit*.ts          ← Limite em memória (Edge) e partilhado (Postgres)
│   ├── jobsRunner.ts          ← Pipeline de jobs em segundo plano
│   ├── realtime.ts            ← LISTEN/NOTIFY do Postgres → SSE
│   ├── inbound.ts             ← Canal de entrada: conversas, escalamento, opt-out
│   ├── costing.ts             ← Custo e margem por dentista, cadeira e tratamento
│   ├── carePathway.ts         ← Encadeamento pré e pós-consulta
│   ├── patientScoring.ts      ← Os três scorings do doente
│   ├── slotRisk.ts            ← Previsão de slot vazio, ao nível do slot
│   ├── agents/                ← Catálogo, coordenação entre agentes, e os que usam IA
│   ├── *Calc.ts               ← Lógica pura, sem BD — é o que os testes unitários cobrem
│   └── types/                 ← Tipos partilhados por domínio
│
├── app/
│   ├── page.tsx               ← Login
│   ├── portal/[token]/        ← Portal do doente (sem sessão, token de uso único)
│   ├── api/                   ← 132 rotas, todas por lib/route.ts's withRoute
│   └── dashboard/
│       ├── super-admin/       ← Plataforma: clínicas, utilizadores, comparação de grupo
│       ├── admin/             ← Direção da clínica
│       ├── receptionist/      ← Receção
│       └── dentist/           ← Clínico
│
├── components/
│   ├── shared/                ← Ecrãs comuns a clínica e plataforma
│   ├── clinic/, super-admin/  ← O que é próprio de cada âmbito
│   └── …                      ← Por domínio: doente, receção, inventário, equipa
├── hooks/                     ← useSpeechRecognition, useSSE
├── test/                      ← 36 ficheiros unitários
│   └── integration/           ← 22 ficheiros contra PostgreSQL real
├── proxy.ts              ← Rate limit de /api/* (1.ª linha) + guards de rota por papel
└── docker-compose.yml         ← postgres, pgadmin, app, jobs
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
   decide. É o que torna 343 testes possíveis sem base de dados
6. **Estado derivado, não guardado**: a etapa da jornada e o estágio de ciclo de vida são
   calculados de fresco a cada leitura. Uma coluna "estágio" dessincroniza-se em silêncio;
   uma derivação não pode
7. **Regras na base de dados, não na disciplina de quem chama**: `updated_at`, cadeia de
   hashes da auditoria e `password_changed_at` são triggers. Uma rota nova não tem como se
   esquecer deles
8. **Catálogos por clínica**: `tenant_id NULL` é o global, uma linha com `tenant_id` é o
   override. Sem cópia por clínica
9. **Automatismo com fronteira**: tudo o que sai da clínica para uma pessoa de fora, e tudo o
   que é irreversível, exige um humano — os agentes preparam, não executam

---

## O que falta

As seis lacunas que este ficheiro listava foram fechadas. O que resta não é código — é
decisão, calibração e contas de terceiros.

| Área | Falta | De quem |
|------|-------|---------|
| **1 · Doente** | Calibrar os pesos dos três scorings contra histórico real. As fórmulas são explicáveis e defensáveis; não são medidas | Precisa de **dados de uma clínica a sério** |
| **3 · Comunicação** | Ligar os dois canais na Twilio: número de SMS e número de voz com transcrição | Conta e configuração, não código |
| **3 · Comunicação** | Subir a autonomia de `off`. O código suporta quatro degraus e o repouso é o primeiro | **Decisão de produto**, de quem responde pela clínica |
| **6 · Operações** | A lista de passos de cada tipo de consulta. O motor está construído | **Protocolo da clínica** |
| **7 · Financeiro** | Preencher os preços de custo e a base de imputação. Sem preços, a margem de material vem subavaliada — e a aplicação diz isso em vez de o esconder | **Contabilidade da clínica** |
| **RGPD** | Avaliação de impacto (DPIA). Os scorings são perfilagem de doentes, e isso obriga | **Encarregado de Proteção de Dados** |

### Dívida técnica

| Área | Estado | Nota |
|------|--------|------|
| Tempo real | **Ligado.** `LISTEN/NOTIFY` do Postgres (migração 051) → `lib/realtime.ts` → SSE → `hooks/useSSE.ts`, com a sala de espera como primeiro consumidor | Substituiu uma sondagem de 5 em 5 segundos por evento a evento; a sondagem fica como rede de segurança, a 60s quando há ligação |
| Uploads | **Verificados.** Assinatura (*magic bytes*) confrontada com o tipo declarado | Fecha a diferença entre «o cliente disse que é um PNG» e «isto é um PNG» — importa sobretudo no portal do doente, a única superfície onde alguém sem sessão escreve um ficheiro |
| Rate limit de escrita | **Partilhado.** As mutações passam por um teto em Postgres dentro de `lib/route.ts` | `lib/rateLimitGlobal.ts` existia e nenhuma rota o chamava — escrito e sem consumidores, como o SSE estava |
| Rate limit genérico de `/api/*` | **Continua por instância.** Em memória, no proxy Edge | Sem solução sem Redis/Upstash. É hoje explicitamente a *primeira linha*, não o teto: as escritas já têm o teto partilhado acima |
| `seed.ts --reset` | **Corrigido.** Apaga o schema inteiro em vez de uma lista de tabelas escrita à mão | A lista tinha voltado a ficar desatualizada, e falhava mal: `DROP TABLE tenants CASCADE` levava as chaves estrangeiras das tabelas fora da lista, e os `CREATE TABLE IF NOT EXISTS` das migrações não as repunham. **Instalações novas ficavam sem `REFERENCES tenants(id)`** em `purchase_orders`, `inventory_batches`, `inventory_movements` e companhia — silenciosamente, e só em bases criadas de raiz |
| Notas clínicas | Texto simples na BD | Cifra ao nível da coluna com KMS por clínica |
| Auth | JWT próprio | Suficiente hoje; NextAuth/Clerk se houver necessidade de SSO |
| TLS | Não é responsabilidade do código — HSTS e cookies `secure` estão postos | Terminação é do deploy |

> **Nota sobre `.env.test`:** as credenciais da base de dados de testes não correspondem às
> do `.env`, e por isso a suite de integração não conseguia sequer ligar-se — 128 testes
> que nunca corriam. Isso escondia dois bugs reais, agora corrigidos: o do `seed.ts` acima,
> e um teste de rate limit que fazia três chamadas e chamava «4.ª tentativa» à terceira.
> Corrigir as credenciais é local e é teu; ver `test/integration/README`.

## Licença

Projeto privado — Portucale Dental
