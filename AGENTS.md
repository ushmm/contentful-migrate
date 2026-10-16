# Repository guidance

## Purpose and structure

- Canonical repository: https://github.com/ushmm/contentful-migrate.
- This is a CommonJS Node.js CLI for per-content-type Contentful schema migrations.
- Keep the existing package name `@devaltitude/contentful-migrate` unless a package rename is explicitly requested; the executable is `ctf-migrate`.
- `bin/ctf-migrate` registers yargs commands from `bin/commands/`: `init`, `create`, `list`, `up`, `down`, and `bootstrap`.
- `lib/load.js` loads node-migrate sets from one directory per content type and wraps their `up`/`down` functions.
- `lib/run.js` parses, validates, renders, and executes Contentful migration plans. It imports private `contentful-migration/built/*` modules: check compatibility carefully when upgrading dependencies.
- `lib/store.js` persists state in the Contentful `migration` content type. Entries use the managed content-type ID as their entry ID; state is locale-keyed and includes `lastRun` and applied migrations.
- `lib/bootstrap.js` and `lib/bootstrap/` generate migration scripts from existing models and optionally rewrite remote migration state.
- `lib/template.js` defines generated migration exports: `description`, `up`, and `down`.

## Development conventions

- Match surrounding CommonJS code: two spaces, single quotes, no semicolons, JavaScript Standard style. ESLint limits lines to 120 characters with string/template exceptions.
- The generated template has its own existing style and is excluded from lint.
- Tests use Mocha and expect.js in adjacent `__tests__/*.spec.js` directories. Add local regression tests when changing behavior; mock remote operations for unit tests.
- There is no compilation step. Do not introduce a framework, TypeScript conversion, or dependency upgrades incidentally.
- Use npm and preserve `package-lock.json`. Avoid `npm audit fix --force` or broad lockfile regeneration without an explicit dependency-maintenance task.
- The manifest declares Node >=14, but the CI matrix is still 10/12/14. Do not assume compatibility with every newer runtime; see `docs/repository-review.md` for observed failures.

## Installation and verification

Run commands from the repository root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run lint
npm test
node bin/ctf-migrate --help
```

The install command avoids legacy lifecycle hooks. If hooks become necessary, inspect them before enabling them.

`npm test` is intended to run lint and unit tests, but there are two known test-harness problems:

1. Mocha 8's bundled yargs fails to start under the observed Node 26.11.1 runtime.
2. `test:unit` includes the integration file before filtering tests. That file checks credentials at module load, so `--grep @integration --invert` does not make it credential-free.

For credential-free local unit verification, explicitly load only the current unit files through Mocha's API:

```sh
node -e "const Mocha = require('mocha'); const suite = new Mocha(); suite.addFile('lib/__tests__/store.spec.js'); suite.addFile('lib/bootstrap/__tests__/jsonToScript.spec.js'); suite.run(failures => { process.exitCode = failures ? 1 : 0 })"
```

Update the explicit file list when adding tests. Report this workaround separately from `npm test`; it does not validate integration behavior.

## Contentful and filesystem safety

- Do not run remote migrations or integration tests without explicit authorization and a confirmed disposable target. Never infer a safe target from defaults: the environment defaults to `master`.
- CLI configuration uses `CONTENTFUL_MANAGEMENT_ACCESS_TOKEN`, `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENV_ID`, and `CONTENTFUL_MIGRATIONS_DIR` (default `./migrations`). Do not print, commit, or embed tokens in documentation or commands.
- `init` writes a real content type and has no dry-run option. `up` and `down` support `--dry-run`, but planning still reads Contentful and executes migration JavaScript; dry-run is not an offline sandbox.
- `bootstrap` deletes local migration directories before generating replacements, even when remote state rewriting is declined. Confirm the resolved directory, selected content types, backups, and user authorization before running it. It has no dry-run option.
- `down` can delete schema/data; do not treat it as a production backup strategy. Keep already-applied migration files immutable and add a new migration instead.
- Avoid simultaneous migration processes against the same environment. Store state and default locale are process-global caches, not keyed by space/environment.
- `npm run test:integration`, `npm run test:all`, and `npm run test:ci` include real API operations. The integration suite requires `CONTENTFUL_INTEGRATION_MANAGEMENT_TOKEN` and `CONTENTFUL_INTEGRATION_SOURCE_SPACE`, creates/deletes an environment, and deletes the repository-root `migrations/` directory during cleanup.
- Root `migrations/` is ignored here for local testing. Consumer projects must version their migration scripts.

## Further context

See `docs/repository-review.md` for analysis, follow-up priorities, verification results, and recommended repository-specific skills. Those skill suggestions are proposals, not installed capabilities.
