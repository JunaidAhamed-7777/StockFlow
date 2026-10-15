# Native role-agent QA · issue #13

Verified on 16 October 2026 (Asia/Kolkata) against local n8n 2.43.6 on the existing
Windows workspace. Private report timestamps use UTC. No paid model session,
scheduled execution, business write or external message was initiated by QA.
Backend, schema, authentication and frontend source remain unchanged.

## Installed configuration and actual reads

The zero-model configuration verifier passed all three current/published agents
before browser review and again after restoring the unexpected drafts described
below. Each configuration matched the reviewed source model, instructions,
encrypted credential reference, one assigned read-only tool, enabled managed
task/objective and Asia/Kolkata schedule:

- **ADMIN / Admin Notification**: StockFlow Local Automation; daily 09:15.
  Guarded tool read 44 products (40 returned), five suppliers and two orders.
- **SUPPLIER / Supplier Assistant**: Supplier Test; weekdays 09:30. Guarded tool
  read four owned products and one related order with supplier-only lines.
- **CUSTOMER / Customer Assistant**: Customer Test; Mondays 10:00. Guarded tool
  read 44 public catalog products (40 returned) and two own orders.

The tool verifier checked all three installed executable graphs before any read,
rechecked each immediately before execution and completed at the safe projection.
Admin/supplier paths executed ten nodes each; customer executed nine. Only API
login and existing read endpoints ran. Each report recorded zero model calls and
zero business mutations; raw JWT-bearing HTTP/CLI output stayed in memory.

A separate private read-only check compared the referenced API credentials with
the exact documented fixed-account records and verified `/auth/me` returned each
expected email/role. The encrypted OpenAI credential matched its root `.env`
source and fixed provider URL without calling OpenAI. Public results contain only
role labels and match booleans. This is a point-in-time credential audit; a
trusted operator replacing credential secrets later requires another audit.

StockFlow remained signed into Customer Test while the three tools used their
separate accounts. Browser review showed the expected model, fixed-account
instructions, assigned tool and schedule. Supplier settings displayed $3/month,
80% warning, $0.10/session, low reasoning, one concurrent tool and six iterations.

## Budgets and recurrence limits

All three source/installed configurations specify a $3 monthly budget, 80%
warning and $0.10 session guardrail, totaling $9 configured monthly. Cross-session
memory and web search are disabled. These are n8n controls checked between calls;
an in-flight call can exceed a threshold. They are not a provider billing cap.
Spend-threshold enforcement was not tested by consuming paid tokens.

Recorded historical spending stayed unchanged: admin $0.00243550, supplier
$0.00131280, customer $0.00264525; total $0.00639355. These are earlier manual
smoke-session costs, not new QA spending.

Each browser Sessions view showed the earlier successful connection verification
under `N8n_chat_production`. No scheduled session was visible. The supplier
schedule dialog showed Friday 16 October at 09:30 as its next due execution.
Enabled configuration and a displayed next time do not prove recurrence. No
schedule was triggered or awaited; actual recurrence remains unobserved.

## Browser finding and restoration

After opening supplier/customer Build/Settings views, the repeated strict
configuration verifier failed. Read-only diagnostics found those two agents had
new unpublished drafts with `memory.enabled: true`; their published versions
still differed from the drafts. The memory control, Test agent and Publish were
not deliberately operated. Admin inspected through Sessions retained its setup.

Both unintended drafts were backed up privately, then restored using native
**More publish actions → Revert changes**. The browser confirmed restoration and
the full verifier passed again with disabled memory and matching current/published
versions. Existing schedules, tool bindings and recorded spending were unchanged.
No unexpected draft was published. The cause of the editor behavior is unproven
and tracked in #17; repeat configuration verification after browser inspection.
The verifier was kept strict and gained an explicit enabled-memory draft test.

The [controlled follow-up investigation](QA-AGENT-EDITOR.md) reproduced an
empty-model Build visit autosaving defaults and a non-memory field edit forcing
the outer memory flag on. A selected-model/no-credential Build/Settings control
stayed unchanged. This identifies native normalization behavior without proving
the original configured-agent inspection trigger. The outer flag controls
session persistence; cross-session episodic recall is a separate setting.

Local browser evidence includes `artifacts/qa/supplier-agent-schedule.jpg`,
`supplier-agent-controls.jpg` and `customer-agent-draft-restored.jpg`. Earlier
editor screenshots must not be treated as proof of the final stored config;
the final verifier is the authoritative configuration result.

## Regression fixes and reproducibility

`node --test "automations/*.test.mjs" "scripts/*.test.mjs"` exercises fixtures
without applying the installer or initiating model/message calls. New coverage:

- Eight scope/report cases cover hostile plain record instructions, 75 total
  versus five search matches, truncation, complete own-line subtotals despite
  projected line limits, oversized input refusal, failed/unfinished envelopes,
  required builder reads/triggers and impossible count subsets.
- The role-tool verifier now rejects failed outer envelopes, missing Scope or
  supplier resolution, non-success/repeated node runs, malformed final output
  and inconsistent counts. It derives required reads from the builder and
  requires exactly one trigger. Real guarded reads passed this complete path.
- Fourteen isolated installer cases cover first setup, repeated setup, lost task
  creation response recovery, exactly one managed task/reference, preserved
  unrelated references and metadata, strict task-list envelopes, re-enabling only
  the managed reference, invalid IDs, occupied agent names, readiness retries,
  redacted failures and final post-publish task/reference integrity.
- CLI dry run passed without private files, directories or installation
  dependencies. Fixture applies do not demonstrate a new live install; no
  installer apply or native restart was performed in this issue.

Installed tools project at most 40 catalog rows, 25 orders, 20 lines per order,
bounded auxiliary lists and 30,000 serialized characters, with truthful returned
and truncated counts. They independently filter supplier/customer ownership and
recompute supplier totals. They contain no business-write, email, Discord,
arbitrary URL, model or delegation nodes. Proposed drafts remain proposals.

These checks establish tool boundaries and configuration, not model obedience
to hostile text. No new behavioral model test was run. Fixed native agents do
not provide StockFlow end-user authentication or implement the frontend's missing
forecasting/recommendation API. Replenishment drafts use recorded thresholds.

Private evidence remains under `.local/`: role configuration/tool verification,
credential-scope match results, draft backups and redacted preservation checks.
Final comparisons retained all seven database collections, nine workflow
definitions/activation settings, six credentials, container identities/start time,
encryption configuration and runtime secrets.

The final integrated run passed 247 script/automation tests and 22 frontend
tests. TypeScript, frontend lint, production build and strict design audit also
passed. The final customer browser reload/sign-in showed the connected
44-product catalog, 12 loaded photographs, no horizontal overflow and no new
warning/error console entries.
