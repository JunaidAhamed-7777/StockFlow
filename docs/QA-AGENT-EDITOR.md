# Native agent editor investigation · issue #17

Verified on 16 October 2026 against local n8n 2.43.6. A disposable agent
reproduced configuration writes after opening Build without another control
being operated. A configured-model control separated that behavior from the
normalization performed on later edits. Cleanup and production preservation
passed. The original trigger for the configured supplier/customer drafts in
[issue #13](QA-ROLE-AGENTS.md) remains unproven.

## Controlled observations

The disposable agent was explicitly created with an empty model and credential,
`memory.enabled: false`, empty tools/tasks/skills/integrations, and unpublished,
non-runnable metadata. Merely listing agents left its configuration unchanged.

Selecting only that QA agent's heading opened Build. No other control was
operated. The editor displayed a default-model notice and automatically assigned
an existing model and credential. Subsequent read-only API comparison found:

- `memory.enabled` changed from false to true.
- The configuration hash changed while the native version stayed the same.
- The agent remained unpublished (`activeVersion: null`) but became runnable
  after the model and credential were automatically assigned. No run occurred.
- Changed configuration fields were `model`, `credential`, `memory`,
  `personalisation` and `config`.

The editor was then left. The changed configuration was backed up privately
before restoring empty model/credential and disabled memory through the native
API, making the disposable agent non-runnable again. The PUT retained optional
defaults; this was not byte-for-byte restoration of the creation payload.

For the comparison, the same unpublished disposable agent was configured with
`openai/gpt-5-mini`, an empty credential and disabled memory. Opening Build and
then Settings left its config and config hash unchanged against the captured
configured baseline. It remained non-runnable.

Only the tool-call concurrency field was then changed from five to one, followed
by Tab. The API comparison found changes only to `memory` and `config`:
`memory.enabled: true`, episodic memory still false, credential still empty,
non-runnable metadata and no active version. This confirms normalization on a
non-memory edit; it does not reproduce a view-only write for configured models.

No Test agent, Publish, New chat, memory toggle or integration control was
operated. No connection test, workflow execution or model call was initiated.
Evidence screenshots are
`artifacts/qa/agent-editor-default-model.jpg`,
`artifacts/qa/agent-editor-configured-control.jpg` and
`artifacts/qa/agent-editor-nonmemory-edit.jpg`.

## Source findings and limits

The reviewed n8n 2.43.6 release resolves to immutable commit
`ffbb9ec54fc02e7f8b54a0b6f41d0a84d0a817f5`. Its editor has two relevant paths:

- Mounting the model selector with an empty model can choose a default and emit
  an automatic model-field update. An existing agent can persist that update
  even when its metadata identifies the source as automatic. See the initial
  default watcher and `onModelChange` in
  [AgentInfoPanel.vue](https://github.com/n8n-io/n8n/blob/ffbb9ec54fc02e7f8b54a0b6f41d0a84d0a817f5/packages/frontend/editor-ui/src/features/agents/components/AgentInfoPanel.vue).
- The editor's `onConfigFieldUpdate` handler forces `memory.enabled: true`
  during field updates. This source behavior is broader than an explicit
  operation of the memory control. Its automatic-update exception applies to
  unsaved agents; existing agents proceed to autosave through
  `normalizeAgentMemoryConfig` in
  [AgentBuilderView.vue](https://github.com/n8n-io/n8n/blob/ffbb9ec54fc02e7f8b54a0b6f41d0a84d0a817f5/packages/frontend/editor-ui/src/features/agents/views/AgentBuilderView.vue).

The observed empty-model sequence is consistent with these paths. The initial
default watcher skips a nonempty model, matching the unchanged configured-model
control. The source and reproduction do not establish what originally caused
the earlier configured production-agent drafts.

`memory.enabled` controls backend session persistence and related session
behavior. Observational memory defaults and title generation are separate
details of that path. Cross-session episodic memory has its own
`memory.episodicMemory.enabled` setting. A false-to-true change in
`memory.enabled` alone does **not** prove cross-session episodic memory became
enabled or that any remembered information was created. The backend outer
memory gate, separate episodic opt-in, observational-memory default and title
generation appear in `applyMemoryFromConfig` and its caller in
[from-json-config.ts](https://github.com/n8n-io/n8n/blob/ffbb9ec54fc02e7f8b54a0b6f41d0a84d0a817f5/packages/cli/src/modules/agents/json-config/from-json-config.ts).

## Upstream-ready reproduction draft

Use a disposable existing agent on n8n 2.43.6 with no tasks or integrations and
no published/runnable state. Keep all model-execution controls unused.

1. Create it with empty model/credential, disabled memory and empty assigned
   tools/tasks/skills/integrations. Capture redacted metadata and configuration
   hash through the native read API.
2. List the agents and repeat that read comparison as a control.
3. Click only the disposable agent heading to open Build. Record the
   default-model notice; do not operate Test, Publish, chat or settings controls.
4. Compare configuration and metadata through the read API. The observed result
   is automatic model/credential assignment, enabled session persistence and a
   changed configuration hash on the same unpublished version. Readiness becomes
   runnable without any Test or Publish operation; this is not an execution.
5. As a separate control, leave the editor and set a configured model, empty
   credential and disabled memory through the API. Capture a new baseline.
   Reopen Build and Settings: the observed config/hash stayed unchanged. Change
   only concurrency from five to one and press Tab: session persistence became
   enabled, while episodic memory stayed disabled and the agent non-runnable.
6. Leave the editor, back up the disposable stages privately, reset it to inert
   state and verify ownership, no publication, tasks, threads or published
   history before deleting only that object. Repeat production preservation.

A view-only visit is expected to preserve an existing agent's configuration
until an explicit configuration action. The observed empty-model visit did not.
The configured-model visit did. Report the empty-model automatic save and the
intentional source normalization on later edits as separate findings. No
external upstream issue or message was posted.

## Upgrade assessment

On 16 October 2026, the official latest-stable release was still
[n8n 2.43.6](https://github.com/n8n-io/n8n/releases/tag/n8n%402.43.6), published
15 October at 07:26 UTC and resolving to the same reviewed commit above. Its
normalization and automatic-update paths therefore remain present. The newer
[2.44.2 release](https://github.com/n8n-io/n8n/releases/tag/n8n%402.44.2) was marked
prerelease and was not installed or verified as a remedy. No newer stable
upgrade has been verified as a fix.

No upgrade, external issue post or external message has been performed. A
candidate upgrade still requires checking these exact paths and repeating the
controlled reproduction. No verified fixed version is claimed.

## Cleanup, preservation and checks

After leaving the editor, the disposable stages were retained privately and
the object reset to inert state. Cleanup checks confirmed its exact identity
and project, unpublished/non-runnable/not-MCP state, zero tasks, zero threads
and zero published history. Deleting that owned fixture succeeded; its GET
returned 404. The reloaded Personal Agents list showed exactly the original
three published agents and no QA fixture. Screenshot:
`artifacts/qa/agent-editor-qa-cleanup.jpg`.

All three production agents' metadata, configuration hashes and recorded spend
remained exactly unchanged. Strict diagnostics retained valid, runnable,
current/published configurations with one managed task each. The repeated wider
preservation check also passed for nine workflows, six credentials, seven
application tables, runtime configuration, secrets and container identities.

Integrated checks passed: 297/297 automation/script tests, 43/43 client tests,
16/16 server tests, TypeScript, frontend lint and production build. These checks
do not constitute an upstream n8n fix or a new paid-model behavior test.

Ignored evidence includes `.local/qa17-stages.json`, `.local/qa17-fixture.json`,
`.local/qa17-cleanup.json` and `.local/qa17-role-preservation.json`. Account
values, credential references, object/session IDs, complete configs and backups
remain private. No n8n source patch, actual upgrade or external post was made.
