import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClient, type PlainClientAPI } from 'contentful-management'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

/**
 * Integration test. Opt-in only: it never runs without explicit authorization.
 *
 * Required environment:
 *   CONTENTFUL_INTEGRATION_OPT_IN=true            explicit "I mean it" flag
 *   CONTENTFUL_INTEGRATION_MANAGEMENT_TOKEN       Contentful management token
 *   CONTENTFUL_INTEGRATION_SOURCE_SPACE           disposable space id to test against
 *
 * Safety notes:
 * - The suite fails without credentials (never throws at module load), so
 *   importing this file is always safe.
 * - A throwaway environment `test-<timestamp>` is created and deleted; nothing
 *   runs against `master` or any pre-existing environment.
 * - Migration scripts execute in an isolated per-run temp directory (never the
 *   repository-root `migrations/` folder).
 */
const OPT_IN = process.env.CONTENTFUL_INTEGRATION_OPT_IN === 'true'
const accessToken = process.env.CONTENTFUL_INTEGRATION_MANAGEMENT_TOKEN || ''
const spaceId = process.env.CONTENTFUL_INTEGRATION_SOURCE_SPACE || ''
const enabled = OPT_IN && accessToken !== '' && spaceId !== ''

const RUN_IF_INTEGRATION = enabled ? describe : describe.skip

const TIME_OUT = 60000 // in milliseconds
const NODE_CMD = 'node'
const MIGRATION_CMD = path.join(process.cwd(), 'dist/cli.js')
const TOKEN_SPACE_ENV_OPTIONS = (): string[] => ['-t', accessToken, '-s', spaceId, '-e', environmentId]

const environmentId = `test-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`

let client: PlainClientAPI
let defaultLocale = ''
let migrationsDir = ''

interface MigrationState {
  lastRun: string
  migrations: Array<{ title: string, timestamp: number }>
}

/** Reads `state` field values of a migration-state entry in the default locale. */
const readMigrationState = async (entryId: string): Promise<MigrationState> => {
  const entry = await client.entry.get({ spaceId, environmentId, entryId })
  const state = (entry.fields.state as Record<string, MigrationState>)[defaultLocale]
  expect(state, `migration state for ${entryId}`).toBeDefined()
  return state
}

const listMigrationEntries = async (): Promise<Array<{ sys: { id: string } }>> => {
  const entries = await client.entry.getMany({
    spaceId,
    environmentId,
    query: { content_type: 'migration', limit: 1000 }
  })
  return entries.items as Array<{ sys: { id: string } }>
}

const runCLI = (...args: string[]): void => {
  const result = spawnSync(NODE_CMD, [MIGRATION_CMD, ...args], {
    env: { ...process.env, CONTENTFUL_MIGRATIONS_DIR: migrationsDir },
    encoding: 'utf8',
    timeout: TIME_OUT
  })
  if (result.status !== 0 || result.error) {
    throw new Error(
      `CLI failed (status ${result.status}): ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${result.error ?? ''}`
    )
  }
}

/** Pipes the given answers to an interactive CLI command (e.g. bootstrap prompts). */
const runInteractiveCLI = (answers: string[], ...args: string[]): void => {
  execFileSync(NODE_CMD, [MIGRATION_CMD, ...args], {
    env: { ...process.env, CONTENTFUL_MIGRATIONS_DIR: migrationsDir },
    input: answers.map(answer => `${answer}\n`).join(''),
    timeout: TIME_OUT
  })
}

async function createTestEnvironment (): Promise<void> {
  client = createClient({ accessToken })
  await client.environment.createWithId({ spaceId, environmentId }, { name: environmentId })
  // The environment is provisioned asynchronously; poll until locales respond.
  const deadline = Date.now() + TIME_OUT
  while (defaultLocale === '' && Date.now() < deadline) {
    try {
      const response = await client.locale.getMany({ spaceId, environmentId, query: { limit: 100 } })
      const locale = response.items.find(item => item.default)
      if (locale) defaultLocale = locale.code
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  if (defaultLocale === '') {
    await deleteTestEnvironment()
    throw new Error(`Timed out waiting for environment ${environmentId} to become ready`)
  }
  // Isolated migrations directory; children receive it via CONTENTFUL_MIGRATIONS_DIR.
  // The repository-root `migrations/` folder is never touched by this suite.
  migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctf-migrate-integration-'))
  process.env.CONTENTFUL_MIGRATIONS_DIR = migrationsDir
}

async function deleteTestEnvironment (): Promise<void> {
  if (migrationsDir !== '') {
    fs.rmSync(migrationsDir, { recursive: true, force: true })
  }
  try {
    await client.environment.delete({ spaceId, environmentId })
  } catch (error) {
    // The environment may not exist (e.g. setup failed early); surface but don't fail the suite
    const reason = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Warning: failed to delete test environment ${environmentId}: ${reason}\n`)
  }
}

RUN_IF_INTEGRATION('Integration Test @integration', () => {
  const contentType = 'horse'
  const contentTypeMigrationsDir = (): string => path.join(migrationsDir, contentType)

  beforeAll(async () => {
    await createTestEnvironment()
  }, TIME_OUT * 2)

  afterAll(async () => {
    await deleteTestEnvironment()
  }, TIME_OUT * 2)

  describe('init command', () => {
    it('should create the migration content model', async () => {
      runCLI('init', ...TOKEN_SPACE_ENV_OPTIONS())

      const migration = await client.contentType.get({ spaceId, environmentId, contentTypeId: 'migration' })
      const { name, displayField, fields } = migration
      expect(name).toBe('Migration')
      expect(displayField).toBe('contentTypeId')
      expect(fields).toHaveLength(2)
      const [state, contentTypeId] = fields
      expect(state.type).toBe('Object')
      expect(contentTypeId.type).toBe('Symbol')
    })
  })

  describe('create command', () => {
    it('should create a template file in migrations folder', () => {
      runCLI('create', '-c', contentType, `create-${contentType}`)

      const contentTypes = fs.readdirSync(migrationsDir)
      expect(contentTypes).toHaveLength(1)
      expect(contentTypes[0]).toBe(contentType)
      const migrationScripts = fs.readdirSync(contentTypeMigrationsDir())
      const fileNameRegExp = new RegExp(`\\d{14}-create-${contentType}.js`)
      expect(migrationScripts[0]).toMatch(fileNameRegExp)
    })
  })

  describe('up command', () => {
    it('-d option should not apply migration', async () => {
      runCLI('up', '-c', contentType, '-d', ...TOKEN_SPACE_ENV_OPTIONS())

      const migrations = await listMigrationEntries()
      expect(migrations).toHaveLength(0)
    })

    it('-c option should apply migration for specified contentType', async () => {
      runCLI('up', '-c', contentType, ...TOKEN_SPACE_ENV_OPTIONS())

      const state = await readMigrationState(contentType)
      const scriptsRan = state.migrations.map(migration => migration.title)
      expect(scriptsRan).toHaveLength(1)

      const migrationScripts = fs.readdirSync(contentTypeMigrationsDir())
      expect(migrationScripts).toEqual(scriptsRan)
    })

    it('-c on same content type without new script should not change last run', async () => {
      const previousState = await readMigrationState(contentType)
      const previousMigrationsLastRun = previousState.migrations[0].timestamp

      runCLI('up', '-c', contentType, ...TOKEN_SPACE_ENV_OPTIONS())

      const currentState = await readMigrationState(contentType)
      expect(currentState.migrations[0].timestamp).toBe(previousMigrationsLastRun)
    })

    it('-c on same content type with new script should change last run', async () => {
      // create another script
      runCLI('create', '-c', contentType, `create-${contentType}`)

      runCLI('up', '-c', contentType, ...TOKEN_SPACE_ENV_OPTIONS())

      const state = await readMigrationState(contentType)
      const scriptsRan = state.migrations.map(migration => migration.title)
      expect(scriptsRan).toHaveLength(2)
      expect(state.lastRun).toBe(scriptsRan[scriptsRan.length - 1])

      const migrationScripts = fs.readdirSync(contentTypeMigrationsDir())
      expect(migrationScripts).toEqual(scriptsRan)
    })

    it('-a should run all content types not migrated', async () => {
      // create script for different content type
      runCLI('create', '-c', 'alpaca', 'create-alpaca')

      runCLI('up', '-a', ...TOKEN_SPACE_ENV_OPTIONS())

      const migrations = await listMigrationEntries()
      expect(migrations).toHaveLength(2)
    })
  })

  describe('down command', () => {
    it('-c option should apply down for the last migration in specified contentType', async () => {
      runCLI('down', '-c', contentType, ...TOKEN_SPACE_ENV_OPTIONS())

      const state = await readMigrationState(contentType)
      expect(state.migrations).toHaveLength(1)
    })

    it('-d option should not apply down migration', async () => {
      runCLI('down', '-c', contentType, '-d', ...TOKEN_SPACE_ENV_OPTIONS())

      const state = await readMigrationState(contentType)
      expect(state.migrations).toHaveLength(1)
    })
  })

  describe('bootstrap command', () => {
    beforeEach(async () => {
      // reset the isolated temp migrations dir for this set of tests
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctf-migrate-integration-'))
      fs.rmSync(migrationsDir, { recursive: true, force: true })
      migrationsDir = emptyDir
      process.env.CONTENTFUL_MIGRATIONS_DIR = migrationsDir
    })

    const createAndPublishContentType = async (id: string, name: string): Promise<void> => {
      const created = await client.contentType.createWithId(
        { spaceId, environmentId, contentTypeId: id },
        {
          name,
          fields: [{ id: 'name', name: 'Name', type: 'Text', required: false, localized: false, disabled: false, omitted: false }]
        }
      )
      await client.contentType.publish({ spaceId, environmentId, contentTypeId: id }, created)
    }

    it('-c option with no response only creates script for content type', async () => {
      await createAndPublishContentType(contentType, 'Horse')

      runInteractiveCLI(['yes', 'no'], 'bootstrap', '-c', contentType, ...TOKEN_SPACE_ENV_OPTIONS())

      const contentTypes = fs.readdirSync(migrationsDir)
      expect(contentTypes).toHaveLength(1)
      expect(contentTypes[0]).toBe(contentType)
      const migrationScripts = fs.readdirSync(contentTypeMigrationsDir())
      const fileNameRegExp = new RegExp(`\\d{14}-create-${contentType}.js`)
      expect(migrationScripts[0]).toMatch(fileNameRegExp)

      const state = await readMigrationState(contentType)
      const scriptsRan = state.migrations.map(migration => migration.title)
      expect(migrationScripts).not.toEqual(scriptsRan)
    })

    it('-c option with no response does not delete other folders in migrations', () => {
      fs.mkdirSync(path.join(migrationsDir, 'dont-delete-pony'), { recursive: true })

      runInteractiveCLI(['yes', 'no'], 'bootstrap', '-c', contentType, ...TOKEN_SPACE_ENV_OPTIONS())

      const contentTypes = fs.readdirSync(migrationsDir)
      expect(contentTypes).toHaveLength(2)
    })

    it('-a option with no response creates scripts for all content types', async () => {
      await createAndPublishContentType('alpaca', 'Alpaca')

      runInteractiveCLI(['yes', 'no'], 'bootstrap', '-a', ...TOKEN_SPACE_ENV_OPTIONS())

      const contentTypes = fs.readdirSync(migrationsDir)
      expect(contentTypes).toHaveLength(2)
    })

    it('-c option with yes response creates the state for specific content type', async () => {
      runInteractiveCLI(['yes', 'yes'], 'bootstrap', '-c', contentType, ...TOKEN_SPACE_ENV_OPTIONS())

      const state = await readMigrationState(contentType)
      const scriptsRan = state.migrations.map(migration => migration.title)
      expect(scriptsRan).toHaveLength(1)

      const migrationScripts = fs.readdirSync(contentTypeMigrationsDir())
      expect(migrationScripts).toEqual(scriptsRan)
    })

    it('-a option with yes overrides the state for all content types', async () => {
      // Approve local replacement, then remote migration-state rewrite.
      runInteractiveCLI(['yes', 'yes'], 'bootstrap', '-a', ...TOKEN_SPACE_ENV_OPTIONS())

      const migrations = await listMigrationEntries()
      expect(migrations.length).toBeGreaterThan(0)
      for (const migration of migrations) {
        const state = await readMigrationState(migration.sys.id)
        const scriptsRan = state.migrations.map(migrationItem => migrationItem.title)
        expect(scriptsRan).toHaveLength(1)

        const migrationScripts = fs.readdirSync(path.join(migrationsDir, migration.sys.id))
        expect(migrationScripts).toEqual(scriptsRan)
      }
    })
  })

  it('never touches the repository-root migrations directory', () => {
    expect(migrationsDir).not.toBe(path.join(process.cwd(), 'migrations'))
    expect(fs.existsSync(path.join(process.cwd(), 'migrations'))).toBe(false)
  })
})
