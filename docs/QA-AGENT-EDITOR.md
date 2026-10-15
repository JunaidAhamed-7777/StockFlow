# Native agent editor investigation · issue #17

Status on 16 October 2026: **IN PROGRESS**. A disposable, unpublished agent
reproduced configuration writes after opening Build without operating another
editor control. The configured-model comparison and final cleanup are still
pending. This report does not establish the original trigger for the configured
supplier/customer drafts recorded in [issue #13](QA-ROLE-AGENTS.md).

## Controlled observations

The disposable agent was explicitly created with an empty model and credential,
`memory.enabled: false`, empty tools/tasks/skills/integrations, and unpublished,
non-runnable metadata. Merely listing agents left its configuration unchanged.

Selecting only that QA agent's heading opened Build. No other control was
operated. The editor displayed a default-model notice and automatically assigned
an existing model and credential. Subsequent read-only API comparison found:

- `memory.enabled` changed from false to true.
- The configuration hash changed while the native version stayed the same.
- The agent remained unpublished and non-runnable.
- Changed configuration fields were `model`, `credential`, `memory`,
  `personalisation` and `config`.

The editor was then left. The changed configuration was backed up privately
before restoring empty model/credential and disabled memory through the native
API. The PUT retained optional default fields, so that reset must not be
described as byte-for-byte restoration of the original creation payload.

No Test agent, Publish, chat, connection test, workflow execution or model call
was initiated. The three production agents' metadata, configuration hashes and
budget records were unchanged in the comparisons reported so far. Final
disposable cleanup and complete preservation checks remain pending.

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
default watcher skips a nonempty model. It does not prove that mounting an
already configured model emits the same update, or that this path caused the
earlier production-agent drafts.

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
   changed configuration hash on the same unpublished version.
5. Leave the editor, back up the disposable configuration privately and restore
   or remove the disposable object through its supported API. Record the actual
   cleanup result and repeat production-agent preservation checks.

A view-only visit is expected to preserve an existing agent's configuration
until an explicit configuration action. The observed empty-model visit did not.
The configured-model/no-credential control is still running; no result is
inferred for that condition.

## Upgrade assessment

On 16 October 2026, the official latest-stable release was still
[n8n 2.43.6](https://github.com/n8n-io/n8n/releases/tag/n8n%402.43.6), published
15 October at 07:26 UTC and resolving to the same reviewed commit above. Its
normalization and automatic-update paths therefore remain present. No newer
stable upgrade has been verified as a remedy.

No upgrade, external issue post or external message has been performed. A
candidate upgrade still requires checking these exact paths and repeating the
controlled reproduction. No verified fixed version is claimed.

Keep account values, credential references, object/session IDs, complete native
configs and backups in ignored private evidence. Final evidence will distinguish
the disposable reproduction, configured-model control, source analysis,
production preservation and cleanup.
