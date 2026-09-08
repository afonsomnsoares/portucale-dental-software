# Portucale Dental — âmbito do produto

Este documento responde a duas perguntas, por esta ordem: **o que é este produto** e **o
que é que ele deliberadamente não é**. A segunda é a mais importante das duas, porque o
âmbito é a decisão mais fácil de erodir sem dar por isso — uma funcionalidade de cada vez,
todas defensáveis isoladamente.

O `README.md` descreve o que está construído e como. Este ficheiro descreve porquê, e onde
está a fronteira.

---

## O que é

Uma **camada de operação e receita** para clínicas dentárias. Não guarda o dia da clínica
para consulta posterior: lê o estado real da clínica e decide o que tem de acontecer a
seguir — quem falta contactar, que vaga ficou por preencher, que plano está por aceitar,
que stock rompe na semana que vem, que passagem de turno ficou por escrever.

> **Uma PMS guarda o que aconteceu. Esta camada decide o que deve acontecer a seguir.**

É essa a frase que separa o que é nosso do que não é. Se uma funcionalidade se descrever
bem como «guardar o que aconteceu», provavelmente pertence à PMS da clínica e não a nós.

Duas consequências práticas:

1. **O registo é meio, não fim.** Guardamos doentes, consultas, tratamentos e faturas
   porque sem esses dados não há decisão nenhuma para tomar — não porque queremos ser o
   arquivo da clínica.
2. **Cada dado que pedimos tem de pagar renda.** Um campo que ninguém lê para decidir nada
   é trabalho de digitação que a clínica faz por nós.

### Para quem

Clínicas dentárias em Portugal, do consultório com uma cadeira ao grupo com várias
unidades. Interface inteiramente em pt-PT, catálogo de procedimentos TANOMD, RGPD como
requisito de base e não como módulo à parte. Multi-clínica num único deploy, com
isolamento em duas camadas independentes (`tenant_id` na aplicação **e** Row-Level
Security no PostgreSQL).

### Os quatro problemas que resolve

| Problema | O que a camada faz | Onde vive |
|---|---|---|
| **Procura que se perde** | Leads com origem e conversão, captação externa por token, triagem e rascunho de resposta | `lib/agents/leadAgent.ts`, `lead_capture_sources` |
| **Agenda que sangra** | Risco de falta, outreach proativo, lista de espera com matching, otimizador read-only | `lib/noShowRisk.ts`, `lib/waitlistMatch.ts`, `lib/scheduleOptimizerCalc.ts` |
| **Receita que fica em cima da mesa** | Planos apresentados e não aceites, recalls, reativação de inativos, saldo em dívida | `lib/recovery.ts`, `lib/lifecycle.ts` |
| **Casa que consome atenção** | Checklists, incidentes com escalamento, passagem de turno, stock e reposição, manutenção | `lib/shiftHandoff.ts`, `lib/inventoryCalc.ts`, `lib/equipment.ts` |

---

## O que está deliberadamente fora

Estas não são funcionalidades por construir. São decisões, algumas delas tomadas **depois**
de o código existir e ter sido apagado.

### Odontograma

**Fora.** O odontograma 3D saiu em `5021da6`, o 2D e toda a noção de «dente» no modelo de
dados saíram na migração `034_remove_odontogram.sql` — `teeth`, `tooth_conditions`,
`treatments.tooth_num`, `lab_orders.tooth_nums`.

O custo foi assumido em claro na própria migração: **um tratamento deixa de poder indicar a
que dente se aplica.** Aceita-se porque o mapa dentário é o registo canónico do que já
aconteceu na boca do doente — é exatamente a definição de PMS. Duplicá-lo aqui cria duas
verdades sobre o mesmo dente, e a nossa seria sempre a menos fiável das duas.

### Imagiologia

**Fora.** Removida em `353c129`. A rota devolvia os mesmos quatro exames a todos os
doentes, sem tocar na base de dados — numa demonstração a um dentista aquilo lê-se como
histórico real, e isso é um risco de credibilidade, não uma funcionalidade incompleta.

Fora também depois de removida: imagem médica exige armazenamento DICOM, visualização
diagnóstica e uma cadeia de responsabilidade que não é a nossa. Ficheiros anexos a uma nota
clínica, esses existem (`uploads`, R2 com fallback local) — é anexo, não é imagiologia.

### Faturação certificada e documentos fiscais

**Fora.** Registamos valor, linhas de item, pagamentos parciais, método e saldo em dívida,
e ligamos a fatura à consulta que a gerou. Não emitimos documento fiscal, não temos série
certificada, não comunicamos à AT.

O documento legal é emitido pelo software certificado da clínica. O caminho previsto é
integração, não substituição.

### Comparticipações, seguros e convenções

**Fora.** `insurance` existe como *método de pagamento* numa fatura e nada mais. Não há
tabelas de comparticipação, submissão a entidades, nem conciliação de reembolsos. É
trabalho de faturação com regras que mudam por entidade e por ano — pertence a quem emite
o documento fiscal.

### Decisão clínica

**Fora, sem exceção.** Nenhuma parte deste sistema diagnostica, sugere tratamento, escolhe
material ou interpreta anamnese. O que existe é coordenação: lembrar que o plano está por
aceitar, que o recall venceu, que faltam dados. As fronteiras estão escritas por agente em
`lib/agents/registry.ts`, e o agente do Doente di-lo em duas palavras — *«coordena; não
pratica atos clínicos»*.

Corolário na geração documental: declarações, justificações e cartas **sem qualquer
conteúdo clínico**, com marcadores de um catálogo fechado. Um marcador desconhecido é
recusado ao gravar o modelo, e não descoberto com o doente à frente.

---

## A fronteira da automatização

O que separa esta camada de um conjunto de cron jobs é a regra sobre quem decide o quê:

> **Tudo o que sai da clínica para uma pessoa de fora, e tudo o que é irreversível, exige
> um humano. Os agentes preparam; não executam.**

Oito agentes (`lib/agents/registry.ts`), cada um com uma fronteira declarada no código e um
conjunto de jobs determinísticos que já corriam antes de existir agente nenhum. Nenhum
agente é trabalho novo a inventar — é a mesma pipeline, agrupada por quem decide o quê.

Onde a regra morde, em concreto:

| Fronteira | Como é imposta |
|---|---|
| O agente Lead qualifica e escreve o rascunho | O envio é uma rota própria com clique humano (`app/api/leads/[id]/send-reply/`) |
| A IA decide o rascunho de reposição de stock | A encomenda nasce em `draft` e nunca sai de lá sozinha |
| O otimizador de agenda propõe | É read-only por desenho: mover uma consulta obriga a avisar o doente |
| O agente de Conformidade sinaliza prazos | Nunca apaga — o apagamento é irreversível e assina-o uma pessoa |
| A retenção de dados corre sozinha | Só em categorias operacionais; tudo o que toca no processo clínico cria tarefa para revisão |
| Um canal marcado «não contactar» | Bloqueia todo o envio automático (`lib/commPrefs.ts`); envios feitos por uma pessoa não são afetados |

A comunicação não é um agente: é o canal por onde todos passam. Por isso a política —
consentimento, canal preferido, limite, deduplicação — vive num sítio só, com o job `send`
como saída única.

---

## Estado de cada capacidade

Mapeamento honesto do que está construído, contra o código. «Construído» significa rota,
página, testes e migração — não protótipo.

| Capacidade | Estado | Código |
|---|---|---|
| Doentes, anamnese, timeline imutável | Construído | `patients`, `medical_history`, `patient_timeline` |
| Notas clínicas com ditado pt-PT | Construído | `hooks/useSpeechRecognition.ts` |
| Prescrições, laboratório, planos, consentimentos, recalls | Construído | `app/api/{prescriptions,lab-orders,recalls,consent-forms}` |
| Agenda com máquina de estados validada no servidor | Construído | `statuses`, `app/api/appointments/[id]/status` |
| Risco de falta, heatmap, outreach proativo | Construído | `lib/noShowRisk.ts` |
| Lista de espera com matching e ofertas expiráveis | Construído | `lib/waitlistMatch.ts`, `slot_offers` |
| Otimizador de agenda | Construído, read-only por desenho | `lib/scheduleOptimizerCalc.ts` |
| Leads, fontes de captação, ciclo de vida, recuperação | Construído | `lib/lifecycle.ts`, `lib/recovery.ts` |
| Faturação interna (registo de valor) | Construído — ver «fora de âmbito» | `invoices` |
| Operações: checklists, incidentes, passagem de turno | Construído | `lib/shiftHandoff.ts` |
| Distribuição automática de tarefas | Construído, determinista | `lib/taskRoutingCalc.ts` |
| Inventário, lotes, previsão, fornecedores, encomendas | Construído | `lib/inventoryCalc.ts` |
| Equipamento e manutenção | Construído | `lib/equipment.ts` |
| Portal do doente sem login | Construído | `app/portal/[token]`, token só em hash |
| Documentos administrativos | Construído, cópia congelada | `lib/documents.ts` |
| Relatórios e comparação de grupo | Construído | `lib/reportsCalc.ts` |
| Diagnóstico por IA sobre métricas já calculadas | Construído, degrada sem `ANTHROPIC_API_KEY` | `lib/agents/` |
| RGPD: consentimentos, direitos do titular, retenção | Mecânica construída; prazos são decisão da clínica | `lib/dataSubject.ts`, `lib/retention.ts` |
| Tempo real na UI | Canal SSE escrito, sem consumidores ligados | `app/api/sse/`, `hooks/useSSE.ts` |
| Cifra ao nível da coluna nas notas clínicas | Por fazer | — |
| Integração com software de faturação certificado | Por fazer — é o caminho, não a substituição | — |

---

## Como decidir sobre uma funcionalidade nova

Por esta ordem. A primeira resposta negativa chega para parar.

1. **É «guardar o que aconteceu»?** Se sim, é da PMS. Não é nosso.
2. **Alguém decide alguma coisa com isto?** Um ecrã que ninguém usa para agir é
   manutenção sem retorno.
3. **Toca em decisão clínica?** Se sim, para. Sem exceção e sem versão atenuada.
4. **Se for automático, o que acontece quando erra?** Se a resposta for irreversível ou
   sair para fora da clínica, o desenho tem de ter um humano no caminho.
5. **Os dados que isto precisa já existem?** Se obriga a digitação nova, o ganho tem de
   ser maior do que o trabalho que cria ao balcão.
6. **Sobrevive sem chave de IA?** Cada dependência de modelo declara como degrada. Sem
   `ANTHROPIC_API_KEY`, ou cai para regra fixa, ou desliga-se — nunca rebenta.

---

## O que não é uma razão para alargar o âmbito

- **«A concorrência tem.»** O odontograma 3D foi removido precisamente com este argumento
  posto de lado: não se escolhe software de gestão por um mapa dentário em três dimensões.
- **«Já está quase feito.»** A imagiologia estava «quase feita» — e o que estava feito era
  dados de demonstração apresentados como registo real.
- **«É só um campo.»** Um campo é uma migração, um formulário, uma validação, uma linha na
  cobertura de RGPD (`test/integration/data-subject-coverage.test.ts` falha se uma tabela
  ligada a um doente aparecer sem decisão de acesso e apagamento) e uma política de RLS.
