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

The reviewed n8n 2.43.6 editor source has two relevant paths:

- Mounting the model selector with an empty model can choose a default and emit
  an automatic model-field update. An existing agent can persist that update
  even when its metadata identifies the source as automatic.
- The editor's `onConfigFieldUpdate` handler forces `memory.enabled: true`
  during field updates. This source behavior is broader than an explicit
  operation of the memory control.

Immutable source permalinks and exact locations will be added after the source
review handoff. The observed empty-model sequence is consistent with these
paths. It does not prove that mounting an already configured model emits the
same update, or that it caused the earlier production-agent drafts.

`memory.enabled` controls backend session persistence and related session
behavior. Observational memory defaults and title generation are separate
details of that path. Cross-session episodic memory has its own
`memory.episodicMemory.enabled` setting. A false-to-true change in
`memory.enabled` alone does **not** prove cross-session episodic memory became
enabled or that any remembered information was created.

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

## Upgrade assessment pending

No upgrade, external issue post or external message has been performed. An
upgrade recommendation requires inspecting an identified newer revision for
these exact update paths and repeating the controlled reproduction against it.
The latest-version label alone would not establish a fix. No verified fixed
version is claimed yet.

Keep account values, credential references, object/session IDs, complete native
configs and backups in ignored private evidence. Final evidence will distinguish
the disposable reproduction, configured-model control, source analysis,
production preservation and cleanup.
