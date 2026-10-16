# Repository review

## Overview

The CLI combines yargs command handling, node-migrate's ordered migration sets, and
Contentful's migration DSL. Each content type has its own migration directory and
remote state entry. `lib/load.js` binds scripts to `lib/run.js`; `lib/store.js` saves
successful migration state in a dedicated `migration` content type. Bootstrap works
in reverse, generating scripts from existing Contentful models.

This repository is a small, uncompiled CommonJS package. Tests cover state formatting
and bootstrap serialization, with a separate live Contentful integration suite.
There are no dedicated unit suites for the runner, loader, or bootstrap orchestration.

## Fork housekeeping completed

- Repository, issues, and homepage metadata now target `ushmm/contentful-migrate`.
- CLI help and the README CI badge point to this repository.
- Installation instructions use this Git repository instead of the original unscoped
  npm package. Upstream npm badges were removed because they did not describe this fork.
- The package name remains `@devaltitude/contentful-migrate`: repository relocation
  does not imply that a new npm scope has been published or authorized.
- External dependency documentation, source attribution, and license information were
  retained. The lockfile contained no old repository URLs requiring replacement.
- Root `AGENTS.md` documents architecture, conventions, verification, and safety rules.

## Prioritized follow-up findings

These are existing issues identified during review, not fixes included in the URL and
onboarding changes. Except for the test results below, they are source-review findings.

### High priority: bootstrap safety and failure reporting

- `lib/bootstrap.js:18-19` deletes scripts before fetching/generating replacements.
  `lib/bootstrap/deleteScripts.js:21-28` removes the entire migrations directory when
  no content types are selected. A generation failure can therefore leave no scripts.
  Stage output separately, validate paths, and replace existing scripts only after
  successful generation and explicit confirmation.
- `lib/bootstrap.js:21` does not await `rewriteMigration`; it can report success before
  remote state writes complete. Its catch block only logs errors (`:24-26`) instead of
  propagating failure. Await state rewriting and test failure exit behavior.

### High priority: generated JavaScript correctness

- `lib/bootstrap/jsonToScript.js:38-48` interpolates content-type IDs as JavaScript
  identifiers and names into quoted source without consistent escaping. Hyphenated IDs,
  reserved words, or quotes in model names can produce invalid scripts.
- `lib/bootstrap/jsonToScript.js:74` returns ESLint's `output` without checking parsing
  errors or whether output exists. Validate generated source before writing it.
- `lib/bootstrap/jsonToScript.js:22-25` drops all falsy field properties, and `:34`
  hardcodes the editor widget namespace to `builtin`. Add round-trip tests for explicit
  false/zero values and non-builtin widgets before changing serialization semantics.

### Medium priority: migration state and error handling

- `lib/store.js:5-12,53-56,155` caches migration state and locale globally rather than
  by space/environment. Multiple targets within one process can share incorrect state.
- State reads are limited to 1,000 entries (`lib/store.js:7-10`); bootstrap content-type
  reads also lack pagination (`lib/bootstrap/generateScripts.js`).
- `lib/run.js:102-111` assumes API error messages contain JSON; `:128-134` assumes every
  execution failure exposes an `errors` array. Network or unexpected errors can be
  masked by secondary exceptions. Add mocked error-path tests.
- `lib/run.js:13-19` depends on private compiled Contentful modules. Dependency updates
  need explicit checks of module paths, exports, plan rendering, and dry-run behavior.

### Medium priority: testing and runtime maintenance

- `package.json` declares Node >=14, but `.github/workflows/main.yml:12` tests Node
  10/12/14 and uses v1 checkout/setup-node actions. Choose and test supported runtimes
  in a separate maintenance change; do not simply assume newer Node compatibility.
- `test:unit` loads all specs and only then excludes `@integration` tests. Integration
  credentials are checked at file load (`lib/__tests__/store.integration.spec.js:18-24`),
  so filtering alone cannot make this command credential-free. Separate test file
  discovery rather than supplying fake credentials.
- Integration environment readiness polling (`lib/__tests__/store.integration.spec.js:36-44`)
  lacks an attempt limit or backoff. Add bounded retries and reliable cleanup.

## Verification performed

- `npm ci --ignore-scripts --no-audit --no-fund`: succeeded; npm reported several
  deprecated dependencies. This was not a vulnerability audit.
- `npm test` on Node **26.11.1**: lint passed, but the Mocha CLI failed before running
  tests with `ReferenceError: require is not defined in ES module scope` in its nested
  `yargs/yargs` module.
- Explicitly loading the two unit spec files through Mocha's programmatic API:
  **18 passing**. The exact credential-free command is in `AGENTS.md`.
- No Contentful migration commands or integration tests were run.

## Recommended skills

These are proposed custom skills, not installed or verified third-party packages.
Keep core safety rules in `AGENTS.md`; put detailed task workflows in skills that load
only when relevant. For OpenCode, each could live at
`.opencode/skills/<skill-id>/SKILL.md` with a clear task-oriented description.

| Priority | Proposed skill ID | When to use / workflow |
| --- | --- | --- |
| 1 | `contentful-migration-safety` | Before any migration, rollback, bootstrap, or integration run: verify target space/environment, inspect scripts for side effects, confirm destructive actions and backup paths, preview supported operations, and verify resulting state. |
| 2 | `contentful-migration-authoring` | Author/review `description`, `up`, and `down` exports, timestamped per-content-type scripts, reference ordering, locale handling, and rollback limitations. Preserve applied history. |
| 3 | `contentful-bootstrap-validation` | Maintain JSON-to-script conversion with parse/round-trip tests for IDs, escaping, falsy values, validations, reference fields, widget namespaces, and staged filesystem replacement. |
| 4 | `contentful-state-debugging` | Diagnose pending/applied mismatches, locale-keyed state, `lastRun`, caching, pagination, version conflicts, and node-migrate callback contracts without rewriting remote state by default. |
| 5 | `contentful-integration-testing` | Operate the live suite only with approval: isolate credentials, use a disposable space, bound readiness polling, protect local migration files, and verify cleanup. |
| 6 | `legacy-node-dependency-upgrades` | Modernize Node/Mocha/ESLint/Contentful dependencies in small steps, check private runner imports and ESLint `CLIEngine` use, preserve lockfile reproducibility, and separate unit verification from authorized integration testing. |

Start with migration safety and bootstrap validation: they address the greatest risk
of accidental state changes or loss of local migration history.
