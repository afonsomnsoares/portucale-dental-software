// O registo de agentes (lib/agents/registry.ts) reparte as tarefas de
// lib/jobsRunner.ts pelos seis agentes. Nada impede que uma tarefa nova nasça sem
// dono, ou que duas fiquem com o mesmo — e nesse caso a página de Agentes mostra
// automação a menos, ou a mesma execução duas vezes. Estes testes fazem disso uma
// falha de build, no mesmo espírito do rls-coverage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENTS, agentForJob, agentJobNames, COMMS_JOB } from '../lib/agents/registry.ts';
import { JOB_NAMES } from '../lib/jobsRunner.ts';

test('nenhuma tarefa do jobsRunner fica sem agente', () => {
  const owned = new Set([...agentJobNames(), COMMS_JOB]);
  const orphans = JOB_NAMES.filter((j) => !owned.has(j));
  assert.deepEqual(
    orphans,
    [],
    `Tarefas sem agente: ${orphans.join(', ')}. Atribui-as em lib/agents/registry.ts ` +
      'ou, se forem canal de saída, ao COMMS_JOB.',
  );
});

test('nenhuma tarefa pertence a dois agentes', () => {
  const seen = new Map<string, string>();
  for (const agent of AGENTS) {
    for (const job of agent.jobs) {
      const already = seen.get(job);
      assert.equal(already, undefined, `'${job}' está em '${already}' e em '${agent.id}'`);
      seen.set(job, agent.id);
    }
  }
});

test('o registo só refere tarefas que existem', () => {
  const real = new Set<string>(JOB_NAMES);
  for (const job of agentJobNames()) {
    assert.ok(real.has(job), `'${job}' não existe em JOB_NAMES — foi renomeada ou removida?`);
  }
});

test('o canal de saída não pertence a nenhum agente', () => {
  // A comunicação é a camada de política partilhada, não o trabalho de um agente.
  assert.equal(agentForJob(COMMS_JOB), null);
});

test('os ids dos agentes são únicos', () => {
  const ids = AGENTS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
});
