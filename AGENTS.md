# Repository guidance

## Purpose and structure

- Canonical repository: https://github.com/ushmm/contentful-migrate.
- TypeScript sources in `src/` compile to CommonJS in `dist/`; Node **>=22.13.0** is required.
- Keep the package name `@devaltitude/contentful-migrate` unless a rename is explicitly requested. The executable `ctf-migrate` runs `dist/cli.js`.
- `src/cli.ts` registers yargs commands from `src/commands/`: `init`, `create`, `list`, `up`, `down`, and `bootstrap`.
- `src/lib/load.ts` loads node-migrate sets from one directory per content type and wraps their `up`/`down` functions.
- `src/lib/run.ts` parses, validates, renders, and executes Contentful plans. Its private `contentful-migration/built/*` imports require compatibility checks on dependency upgrades.
- `src/lib/store.ts` persists locale-keyed state in the Contentful `migration` content type. Entries use the managed content-type ID as their entry ID. State and locale caches are keyed by space/environment.
- Bootstrap generates CommonJS migration scripts from existing models and can rewrite remote migration state. `templates/` holds the migration template; exports remain `description`, `up`, and `down`.

## Development conventions

- Match surrounding TypeScript: two spaces, single quotes, no semicolons. Use the flat ESLint configuration and existing types; do not hand-edit generated `dist/` files.
- Tooling uses TypeScript, Vitest, ESLint, neostandard, and typescript-eslint. Runtime dependencies include Contentful management/migration SDKs, node-migrate, yargs, Chalk, and Listr2. Keep private SDK imports and CommonJS compatibility in mind when updating them.
- Unit tests use Vitest in adjacent `__tests__/*.spec.ts` files. Mock remote operations and add regression tests for behavior changes. `*.integration.spec.ts` files are excluded from default unit discovery.
- Use npm and preserve `package-lock.json`. Avoid `npm audit fix --force` or incidental broad dependency upgrades.

## Installation and verification

Run from the repository root with Node >=22.13.0:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
node dist/cli.js --help
```

Installation skips lifecycle scripts, so the explicit build is required. `npm test` runs lint and credential-free Vitest unit tests; `npm run test:unit` runs unit tests alone. CI uses Node 22/24/26 with no integration credentials or remote API operations. These commands are the verification procedure, not a claim that this revision has passed them.

## Contentful and filesystem safety

- Do not run remote migrations or integration tests without explicit authorization and a confirmed disposable target. Never infer a safe target from defaults: the environment defaults to `master`.
- CLI configuration uses `CONTENTFUL_MANAGEMENT_ACCESS_TOKEN`, `CONTENTFUL_SPACE_ID`, `CONTENTFUL_ENV_ID`, and `CONTENTFUL_MIGRATIONS_DIR` (default `./migrations`). Do not print, commit, or embed tokens in documentation or commands.
- `init` writes a real content type and has no dry-run option. `up` and `down` support `--dry-run`, but planning reads Contentful and executes migration JavaScript; it is not an offline sandbox.
- `bootstrap` stages generated scripts before replacing existing local scripts. Replacement is still destructive, even when remote state rewriting is declined, and there is no dry-run option. Confirm the resolved directory, selected content types, backups, and authorization first; staging is not a backup or a transaction with remote state.
- `down` can delete schema/data and is not a production backup strategy. Keep applied migration files immutable; add new migrations instead.
- Avoid simultaneous migration processes against the same environment. Space/environment-keyed caches prevent cross-target reuse, not concurrent remote writes.
- `npm run test:integration` uses a separate Vitest configuration. The current opt-in flag is `CONTENTFUL_INTEGRATION_OPT_IN=true`, with `CONTENTFUL_INTEGRATION_MANAGEMENT_TOKEN` and `CONTENTFUL_INTEGRATION_SOURCE_SPACE`. The suite creates/deletes a temporary environment and uses a temporary local migrations directory. Confirm a disposable space and cleanup; never enable it in normal CI.
- Root `migrations/` is ignored here for local testing. Consumer projects must version their migration scripts.

## Further context

`docs/repository-review.md` preserves the superseded pre-TypeScript review and its historical verification results. It is not a current defect list or evidence that the modernized build passes. Suggested repository-specific skills there are proposals, not installed capabilities.
