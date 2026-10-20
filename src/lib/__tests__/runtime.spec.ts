import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mocks for contentful-migration's private internals and the Contentful state
// store, so run/load can be exercised fully offline.
const contentfulMocks = vi.hoisted(() => ({
  makeRequest: vi.fn<(request: unknown) => Promise<unknown>>(),
  migrationParserFn: vi.fn<(migrationFunction: unknown) => Promise<unknown>>(),
  renderPlan: vi.fn(async () => undefined),
  renderValidationErrors: vi.fn(),
  renderRuntimeErrors: vi.fn(),
  stepsErrors: vi.fn(),
  writeErrorsToLog: vi.fn(async () => undefined)
}))

vi.mock('contentful-migration/built/bin/lib/contentful-client', () => ({
  createManagementClient: vi.fn(() => ({}))
}))
vi.mock('contentful-migration/built/bin/cli', () => ({
  createMakeRequest: vi.fn(() => contentfulMocks.makeRequest)
}))
vi.mock('contentful-migration/built/lib/migration-parser', () => ({
  default: vi.fn(() => contentfulMocks.migrationParserFn)
}))
vi.mock('contentful-migration/built/bin/lib/render-migration', () => ({
  renderPlan: contentfulMocks.renderPlan,
  renderValidationErrors: contentfulMocks.renderValidationErrors,
  renderRuntimeErrors: contentfulMocks.renderRuntimeErrors
}))
vi.mock('contentful-migration/built/bin/lib/steps-errors', () => ({
  default: contentfulMocks.stepsErrors
}))
vi.mock('contentful-migration/built/bin/lib/write-errors-to-log', () => ({
  default: contentfulMocks.writeErrorsToLog
}))

const storeMocks = vi.hoisted(() => ({
  createStoreFactory: vi.fn(async () => ({
    locale: 'en-US',
    newStore: (contentType: string) => ({
      contentTypeID: contentType,
      load: (fn: (err: Error | null, state?: Record<string, never>) => void) => fn(null, {}),
      save: (_set: unknown, fn: (err?: Error | null) => void) => fn()
    })
  }))
}))
vi.mock('../store', () => ({ createStoreFactory: storeMocks.createStoreFactory }))

import { load, readContentTypes } from '../load'
import { runMigration, MigrationError } from '../run'
import { camelToDash, errorMessage, formatLocalDateTime, formatUtcTimestamp, mapWithConcurrency } from '../utils'

const options = { spaceId: 'space', environmentId: 'env', accessToken: 'token' }

const makeParseResult = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  batches: [],
  stepsValidationErrors: [],
  payloadValidationErrors: [],
  hasStepsValidationErrors: () => false,
  hasPayloadValidationErrors: () => false,
  hasValidationErrors: () => false,
  hasRuntimeErrors: () => false,
  getRuntimeErrors: () => [],
  ...overrides
})

const makeRequestObject = (url = '/x'): Record<string, unknown> => ({
  method: 'PUT',
  url,
  headers: { 'X-Contentful-Version': 1 }
})

const makeBatch = (requests: Array<Record<string, unknown>>): Record<string, unknown> => ({
  intent: { toPlanMessage: () => ({ heading: 'Batch heading' }) },
  requests
})

const noop = (): void => {}

beforeEach(() => {
  contentfulMocks.migrationParserFn.mockResolvedValue(makeParseResult())
  contentfulMocks.makeRequest.mockResolvedValue({})
  vi.spyOn(console, 'log').mockImplementation(noop)
  vi.spyOn(console, 'error').mockImplementation(noop)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runMigration', () => {
  it('dry run renders the plan without executing requests', async () => {
    const batch = makeBatch([makeRequestObject()])
    contentfulMocks.migrationParserFn.mockResolvedValue(makeParseResult({ batches: [batch] }))

    await runMigration({ ...options, dryRun: true, migrationFunction: noop as any })

    expect(contentfulMocks.renderPlan).toHaveBeenCalledWith([batch], 'env')
    expect(contentfulMocks.makeRequest).not.toHaveBeenCalled()
  })

  it('executes every request of every batch through makeRequest', async () => {
    const requestsA = [makeRequestObject('/a'), makeRequestObject('/b')]
    const requestsB = [makeRequestObject('/c')]
    contentfulMocks.migrationParserFn.mockResolvedValue(
      makeParseResult({ batches: [makeBatch(requestsA), makeBatch(requestsB)] })
    )

    await runMigration({ ...options, migrationFunction: noop as any })

    expect(contentfulMocks.makeRequest.mock.calls.map(([request]) => request))
      .toEqual([...requestsA, ...requestsB])
  })

  it('rejects with a BatchError carrying parsed request errors and logs them to file', async () => {
    const apiError = {
      statusText: 'Bad Request',
      message: 'Validation error',
      details: { errors: [{ name: 'required' }] },
      request: { url: 'https://api.contentful.com/spaces/space' }
    }
    contentfulMocks.migrationParserFn.mockResolvedValue(
      makeParseResult({ batches: [makeBatch([makeRequestObject()])] })
    )
    contentfulMocks.makeRequest.mockRejectedValue(new Error(JSON.stringify(apiError)))

    const failure = await runMigration({ ...options, migrationFunction: noop as any })
      .then(() => null, (error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect((failure as { name: string }).name).toBe('BatchError')
    const nested = (failure as { errors: Error[] }).errors
    expect(nested).toHaveLength(1)
    expect(JSON.parse(nested[0].message)).toEqual({
      status: 'Bad Request',
      message: 'Validation error',
      details: { errors: [{ name: 'required' }] },
      url: 'https://api.contentful.com/spaces/space'
    })
    expect(contentfulMocks.writeErrorsToLog).toHaveBeenCalledWith(
      expect.any(Error),
      expect.stringMatching(/errors-\d+\.log$/)
    )
  })

  it('tolerates non-JSON request error messages', async () => {
    contentfulMocks.migrationParserFn.mockResolvedValue(
      makeParseResult({ batches: [makeBatch([makeRequestObject()])] })
    )
    contentfulMocks.makeRequest.mockRejectedValue(new Error('plain failure'))

    const failure = await runMigration({ ...options, migrationFunction: noop as any })
      .then(() => null, (error: unknown) => error)

    const nested = (failure as { errors: Error[] }).errors
    expect(nested[0].message).toBe('plain failure')
  })

  it('rejects with MigrationError on step validation errors', async () => {
    contentfulMocks.migrationParserFn.mockResolvedValue(makeParseResult({
      hasStepsValidationErrors: () => true,
      stepsValidationErrors: [{ message: 'invalid step' }]
    }))

    await expect(runMigration({ ...options, migrationFunction: noop as any }))
      .rejects.toMatchObject({ name: 'MigrationError', message: 'Step validation errors', errors: [{ message: 'invalid step' }] })
    expect(contentfulMocks.stepsErrors).toHaveBeenCalledWith([{ message: 'invalid step' }])
  })

  it('rejects with MigrationError on payload validation errors', async () => {
    contentfulMocks.migrationParserFn.mockResolvedValue(makeParseResult({
      hasPayloadValidationErrors: () => true,
      payloadValidationErrors: [{ message: 'invalid payload' }]
    }))

    await expect(runMigration({ ...options, migrationFunction: noop as any }))
      .rejects.toMatchObject({ name: 'MigrationError', message: 'Payload validation errors' })
  })

  it('rejects with MigrationError on validation errors and renders batches', async () => {
    const batches = [makeBatch([])]
    contentfulMocks.migrationParserFn.mockResolvedValue(makeParseResult({
      batches,
      hasValidationErrors: () => true
    }))

    await expect(runMigration({ ...options, migrationFunction: noop as any }))
      .rejects.toMatchObject({ name: 'MigrationError', message: 'Validation errors' })
    expect(contentfulMocks.renderValidationErrors).toHaveBeenCalledWith(batches, 'env')
  })

  it('writes runtime errors to the errors log and rejects', async () => {
    const runtimeErrors = [{ message: 'runtime' }]
    contentfulMocks.migrationParserFn.mockResolvedValue(makeParseResult({
      hasRuntimeErrors: () => true,
      getRuntimeErrors: () => runtimeErrors
    }))

    await expect(runMigration({ ...options, migrationFunction: noop as any }))
      .rejects.toMatchObject({ name: 'MigrationError', message: 'Runtime errors', errors: runtimeErrors })
    expect(contentfulMocks.writeErrorsToLog).toHaveBeenCalledWith(
      runtimeErrors,
      expect.stringMatching(/errors-\d+\.log$/)
    )
  })

  it('rejects with MigrationError instead of exiting when the parser throws', async () => {
    contentfulMocks.migrationParserFn.mockRejectedValue(new Error('cannot access space'))

    await expect(runMigration({ ...options, migrationFunction: noop as any }))
      .rejects.toBeInstanceOf(MigrationError)
  })
})

describe('load', () => {
  let root: string
  let migrationsDirectory: string

  const writeMigration = (directory: string, name: string): void => {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, name), `module.exports.description = 'desc'
module.exports.up = function (migration) { return migration }
module.exports.down = function (migration) { return migration.deleteContentType('x') }
`)
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctf-migrate-load-'))
    migrationsDirectory = path.join(root, 'migrations')
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('returns empty sets when the migrations directory does not exist', async () => {
    const sets = await load({ ...options, migrationsDirectory: path.join(root, 'missing') })
    expect(sets).toEqual([])
    expect(readContentTypes(path.join(root, 'missing'))).toEqual([])
  })

  it('loads one set per content type directory and filters non-migration files', async () => {
    writeMigration(path.join(migrationsDirectory, 'blogPost'), '20200101000000-first.js')
    fs.writeFileSync(path.join(migrationsDirectory, 'blogPost', 'notes.md'), '# not a migration')
    fs.writeFileSync(path.join(migrationsDirectory, 'blogPost', 'second.spec.ts'), '// not a migration')
    writeMigration(path.join(migrationsDirectory, 'author'), '20200101000000-first.js')

    const sets = await Promise.all(await load({ ...options, migrationsDirectory, dryRun: true }))

    expect(sets).toHaveLength(2)
    expect(sets[0].store.contentTypeID).toBe('author')
    expect(sets[1].store.contentTypeID).toBe('blogPost')
    expect(sets[1].migrations.map(migration => migration.title)).toEqual(['20200101000000-first.js'])
    expect(sets[1].migrations[0].up).toBeInstanceOf(Function)
    expect(sets[1].migrations[0].down).toBeInstanceOf(Function)
  })

  it('respects an explicit content type filter', async () => {
    writeMigration(path.join(migrationsDirectory, 'blogPost'), '20200101000000-first.js')
    writeMigration(path.join(migrationsDirectory, 'author'), '20200101000000-first.js')

    const sets = await Promise.all(await load({
      ...options,
      migrationsDirectory,
      dryRun: true,
      contentTypes: ['blogPost']
    }))

    expect(sets).toHaveLength(1)
    expect(sets[0].store.contentTypeID).toBe('blogPost')
  })

  it('wraps migration functions so they run through runMigration', async () => {
    contentfulMocks.migrationParserFn.mockResolvedValue(makeParseResult())
    writeMigration(path.join(migrationsDirectory, 'blogPost'), '20200101000000-first.js')

    const [set] = await Promise.all(await load({ ...options, migrationsDirectory, dryRun: true }))
    const [migration] = set.migrations

    const upError = await new Promise<Error | null>((resolve) => {
      migration.up?.((error?: Error | null) => resolve(error ?? null))
    })

    expect(upError).toBeNull()
    // dry-run with no batches: parsed once, no requests executed
    expect(contentfulMocks.migrationParserFn).toHaveBeenCalledTimes(1)
    expect(contentfulMocks.makeRequest).not.toHaveBeenCalled()
  })

  it('propagates runMigration failures to the node-migrate callback', async () => {
    contentfulMocks.migrationParserFn.mockRejectedValue(new Error('space unavailable'))
    writeMigration(path.join(migrationsDirectory, 'blogPost'), '20200101000000-first.js')

    const [set] = await Promise.all(await load({ ...options, migrationsDirectory }))

    const upError = await new Promise<Error | null>((resolve) => {
      set.migrations[0].up?.((error?: Error | null) => resolve(error ?? null))
    })

    expect(upError).toBeInstanceOf(MigrationError)
  })
})

describe('utils', () => {
  it('formatUtcTimestamp produces yyyymmddHHMMss in UTC', () => {
    const date = new Date(Date.UTC(2020, 0, 2, 3, 4, 5))
    expect(formatUtcTimestamp(date)).toBe('20200102030405')
  })

  it('formatLocalDateTime produces yyyy-mm-dd HH:MM:ss', () => {
    expect(formatLocalDateTime(new Date(2020, 0, 2, 3, 4, 5))).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('camelToDash converts camelCase to dash-case', () => {
    expect(camelToDash('blogPost')).toBe('blog-post')
    expect(camelToDash('myHTTPServer2')).toBe('my-h-t-t-p-server2')
    expect(camelToDash('plain')).toBe('plain')
  })

  it('errorMessage extracts messages from Errors and stringifies the rest', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage('boom')).toBe('boom')
  })

  it('mapWithConcurrency preserves order and limits concurrency', async () => {
    let active = 0
    let maxActive = 0
    const items = Array.from({ length: 20 }, (_, index) => index)

    const results = await mapWithConcurrency(items, async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active -= 1
      return item * 2
    }, 3)

    expect(results).toEqual(items.map(item => item * 2))
    expect(maxActive).toBeLessThanOrEqual(3)
    expect(maxActive).toBeGreaterThan(1)
  })

  it('mapWithConcurrency handles empty input', async () => {
    expect(await mapWithConcurrency([], async () => 1, 3)).toEqual([])
  })
})
