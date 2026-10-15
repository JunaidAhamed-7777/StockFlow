# Clean Windows setup QA · issue #15

Status: **open; clean-host execution unavailable**, 16 October 2026. The user
explicitly requested leaving #15 open and continuing #16–#17. No first-install
duration or first browser sign-in result is claimed.

## Environment checked

The available host is Windows 11 Home Single Language, version 10.0.26300,
build 26300, with retained StockFlow database and n8n state. Windows Sandbox's
binary, Hyper-V VM service/tools, VirtualBox CLI and VMware CLI were absent.
There is no supplied disposable Windows host available to this task. The
existing workspace was not reset, and a temporary folder or Linux container was
not presented as a fresh Windows installation.

## Setup defect found by source/fixture review

Prisma's package postinstall can create a throwing placeholder
`node_modules/.prisma/client/index.js` before generation succeeds. The launcher
previously treated that filename's existence as sufficient evidence of a
generated client. It could then push the initial schema with `--skip-generate`
and fail during the seed, leaving the intended non-empty-schema recovery guard
to refuse the next start.

The launcher now checks generated schema and runtime/model artifacts before
skipping generation. A placeholder does not qualify. A running verified API is
protected from engine replacement; an invalid client requires stopping it
before generation. Offline regressions cover the actual postinstall placeholder
and valid artifacts. These are setup-contract tests, not a clean-host run.

All 36 runtime/lock tests passed. The read-only artifact check accepted the
actual generated client, and repeated start on the retained workspace completed
successfully with byte-identical runtime markers (including process identities).

## Completion run on a supplied disposable Windows host

Follow `LOCAL-DEVELOPMENT.md` from a fresh clone and `npm install`. Before start,
record OS/Node/npm/Docker versions, confirm no StockFlow runtime markers or named
database/n8n resources, and confirm the application ports are free. Keep raw logs
and account values private. Do not remove unrelated resources to make a run pass.

Measure installation and readiness separately. Once `npm run dev` reports ready,
generate the private local login reference with `node scripts/write-login-doc.mjs`
and perform a real browser sign-in with a seeded account. Record elapsed time to
the first successful workspace view; do not substitute API health or a fixture
initialization for sign-in.

Repeat start/status/stop/start/restart through the documented launcher. Verify
one listener per application port, unchanged database-row fingerprints and
unchanged n8n workflows/credentials/settings. Exercise offline/error recovery in
the browser. Record any startup defect and its recovery without resetting the
retained state. Close #15 only after these actual host/browser results exist.

Existing-workspace lifecycle evidence remains in `QA-LOCAL-RUNTIME.md`; the
approved paging restart preservation check is in `QA-PAGINATED-READS.md`.
