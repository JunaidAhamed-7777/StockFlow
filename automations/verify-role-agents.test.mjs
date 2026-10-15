import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_AGENT_PLANS, createRoleAgentConfig } from './role-agent-definitions.mjs';
import { verifyPublishedAgent } from './verify-role-agents.mjs';

const fixture = (plan) => {
  const config = createRoleAgentConfig(plan);
  config.tasks = [{ type: 'task', id: 'Task01', enabled: true }];
  return [plan, { id: 'Agent01', name: plan.name, isRunnable: true, setupCompletedAt: '2026-10-15', activeVersionId: 'Version01', versionId: 'Version01' }, config, [{ id: 'Task01', name: plan.taskName, objective: plan.objective, cronExpression: plan.cronExpression, timezone: 'Asia/Kolkata' }], { status: 'valid' }, { spentUsd: 0.002 }];
};

test('all reviewed role configurations verify without model calls or secret output', () => {
  for (const plan of ROLE_AGENT_PLANS) {
    const report = verifyPublishedAgent(...fixture(plan));
    assert.equal(report.model, 'openai/gpt-5-mini');
    assert.equal(report.boundAccount, plan.boundAccount);
    assert.equal(report.readOnly, true);
    assert.doesNotMatch(JSON.stringify(report), /apiKey|credential|password|instructions/);
  }
});

test('changed models, tool scopes, instructions and guardrails fail verification', () => {
  for (const mutate of [config => { config.model = 'openai/gpt-5-nano'; }, config => { config.tools[0].workflowId = 'OtherAccount'; }, config => { config.instructions = 'unsafe'; }, config => { config.config.guardrails.budget.enabled = false; }, config => { config.providerTools = [{type:'web_search'}]; }]) {
    const values = fixture(ROLE_AGENT_PLANS[0]);
    mutate(values[2]);
    assert.throws(() => verifyPublishedAgent(...values), /configuration differs/);
  }
});

test('draft versions, disabled tasks and changed scheduled objectives fail verification', () => {
  for (const mutate of [values => { values[1].activeVersionId = 'OldVersion'; }, values => { values[2].tasks[0].enabled = false; }, values => { values[3][0].objective = 'Write stock'; }, values => { values[3][0].cronExpression = '* * * * *'; }]) {
    const values = fixture(ROLE_AGENT_PLANS[1]);
    mutate(values);
    assert.throws(() => verifyPublishedAgent(...values));
  }
});

test('an editor-style enabled-memory draft is rejected and the original published configuration still passes', () => {
  for (const plan of ROLE_AGENT_PLANS) {
    const values = fixture(plan);
    values[2].memory.enabled = true;
    assert.throws(() => verifyPublishedAgent(...values), /configuration differs/);
    values[1].versionId = 'UnpublishedEditorDraft';
    assert.throws(() => verifyPublishedAgent(...values), /configuration differs/);
    values[2].memory.enabled = false;
    values[1].versionId = values[1].activeVersionId;
    assert.doesNotThrow(() => verifyPublishedAgent(...values));
  }
});
