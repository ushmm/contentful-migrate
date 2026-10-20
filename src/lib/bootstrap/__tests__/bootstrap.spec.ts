import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Offline mocks for the Contentful management client and the state store.
const mocks = vi.hoisted(() => ({
  contentTypeGetMany: vi.fn(),
  editorInterfaceGet: vi.fn(),
  writeState: vi.fn<(set: unknown) => Promise<void>>(),
  newStore: vi.fn()
}))

vi.mock('contentful-management', () => ({
  createClient: vi.fn(() => ({
    contentType: { getMany: mocks.contentTypeGetMany },
    editorInterface: { get: mocks.editorInterfaceGet }
  }))
}))

vi.mock('../../store', () => ({
  createStoreFactory: vi.fn(async () => ({
    locale: 'en-US',
    newStore: mocks.newStore
  }))
}))

/* eslint-disable no-new-func -- the Function constructor asserts on generated script syntax intentionally */
import bootstrap from '../index'
import deleteScripts from '../deleteScripts'
import generateScripts from '../generateScripts'
import {
  createChangeFieldControl,
  jsonToScript,
  rejectEmptyObjects,
  removeNullValues,
  toIdentifier
} from '../jsonToScript'

const connection = { accessToken: 'token', spaceId: 'space', environmentId: 'env' }

const contentType = (id: string, extra: Record<string, unknown> = {}) => ({
  sys: { id },
  name: `Name ${id}`,
  displayField: 'title',
  fields: [{ id: 'title', name: 'Title', type: 'Symbol', required: true, validations: [] }],
  ...extra
})

/** Simulates the Contentful skip/limit pagination over a fixed list. */
const paginate = (items: unknown[]) => async ({ query }: { query: { skip?: number, limit?: number } }) => {
  const skip = query.skip ?? 0
  const limit = query.limit ?? 100
  return { items: items.slice(skip, skip + limit), total: items.length, skip, limit }
}

const listFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { recursive: true, encoding: 'utf8' }).sort()
}

let root: string
let migrationsDirectory: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctf-migrate-bootstrap-'))
  migrationsDirectory = path.join(root, 'migrations')
  mocks.editorInterfaceGet.mockResolvedValue({ controls: [{ fieldId: 'title', widgetId: 'singleLine' }] })
  mocks.writeState.mockResolvedValue(undefined)
  mocks.newStore.mockImplementation((contentTypeId: string) => ({
    contentTypeID: contentTypeId,
    writeState: mocks.writeState
  }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('jsonToScript', () => {
  it('produces a syntactically valid script with embedded Standard-style literals', () => {
    const script = jsonToScript(contentType('blogPost') as never, [
      { fieldId: 'title', widgetId: 'singleLine' },
      { fieldId: 'body', widgetId: 'markdown', settings: { helpText: 'Body' } }
    ])

    expect(script).toContain('module.exports.description = "Create content model for Name blogPost";')
    expect(script).toContain("const blogPost = migration.createContentType('blogPost')")
    expect(script).toContain('helpText: "Body"')
    expect(() => new Function('module', script)).not.toThrow()
  })

  it('uses a valid variable name for ids that are not JS identifiers', () => {
    const script = jsonToScript(contentType('author-bio') as never, [])
    expect(script).toContain("const authorBio = migration.createContentType('author-bio')")
    expect(script).toContain('authorBio.createField(')
    expect(script).toContain('migration.deleteContentType("author-bio")')
    expect(() => new Function('module', script)).not.toThrow()
  })

  it('handles content type names with quotes safely', () => {
    const script = jsonToScript(contentType('blogPost', { name: 'It\'s "quoted"' }) as never, [])
    expect(() => new Function('module', script)).not.toThrow()
    expect(script).toContain('module.exports.description = "Create content model for It\'s \\"quoted\\"";')
  })

  it('does not emit undefined content type props', () => {
    const script = jsonToScript(contentType('blogPost') as never, [])
    expect(script).not.toContain('undefined')
    expect(script).not.toContain('.description(')
  })

  it('runs the generated up/down against a fake migration object', () => {
    const script = jsonToScript(contentType('author-bio') as never, [{ fieldId: 'title', widgetId: 'singleLine' }])
    const module = { exports: {} as Record<string, (migration: unknown) => unknown> }
    new Function('module', script)(module)

    const calls: string[] = []
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_target, key: string) => (...args: unknown[]) => {
        calls.push(`${key}(${JSON.stringify(args)})`)
        return chain
      }
    })
    module.exports.up(chain)
    module.exports.down(chain)

    expect(calls[0]).toBe('createContentType(["author-bio"])')
    expect(calls).toContain('createField(["title"])')
    expect(calls).toContain('changeFieldControl(["title","builtin","singleLine"])')
    expect(calls[calls.length - 1]).toBe('deleteContentType(["author-bio"])')
  })

  it('toIdentifier converts dashes into camelCase', () => {
    expect(toIdentifier('author-bio')).toBe('authorBio')
    expect(toIdentifier('a--b_c')).toBe('aB_c')
  })

  it('createChangeFieldControl escapes ids safely', () => {
    expect(createChangeFieldControl('x', { fieldId: 'a"b', widgetId: 'w' }))
      .toBe('x.changeFieldControl("a\\"b", "builtin", "w");')
  })

  it('rejectEmptyObjects does not crash on null/undefined values', () => {
    expect(rejectEmptyObjects(['a', null])).toBe(false)
    expect(rejectEmptyObjects(['a', undefined])).toBe(false)
    expect(rejectEmptyObjects(['a', []])).toBe(false)
    expect(rejectEmptyObjects(['a', {}])).toBe(false)
    expect(rejectEmptyObjects(['a', 'value'])).toBe(true)
  })

  it('removeNullValues prunes nested nulls', () => {
    expect(removeNullValues({ a: null, b: { c: null, d: 1 } })).toEqual({ b: { d: 1 } })
  })
})

describe('generateScripts', () => {
  it('follows pagination beyond 1000 content types and skips the migration content type', async () => {
    const all = [
      contentType('migration'),
      ...Array.from({ length: 1001 }, (_, index) => contentType(`type${index}`))
    ]
    mocks.contentTypeGetMany.mockImplementation(paginate(all))
    // Only generate two of them to keep the test fast; pagination must still reach page 2.
    const files = await generateScripts({
      ...connection,
      contentTypes: ['type0', 'type1000'],
      migrationsDirectory
    })

    expect(mocks.contentTypeGetMany).toHaveBeenCalledTimes(2)
    expect(mocks.contentTypeGetMany.mock.calls[1][0].query).toEqual({ limit: 1000, skip: 1000 })
    expect(files.map(file => file.contentTypeId)).toEqual(['type0', 'type1000'])
    expect(listFiles(migrationsDirectory).filter(file => file.endsWith('.js'))).toHaveLength(2)
  })

  it('never generates a script for the migration content type', async () => {
    mocks.contentTypeGetMany.mockImplementation(paginate([contentType('migration'), contentType('blogPost')]))

    const files = await generateScripts({ ...connection, contentTypes: [], migrationsDirectory })

    expect(files.map(file => file.contentTypeId)).toEqual(['blogPost'])
    expect(fs.existsSync(path.join(migrationsDirectory, 'migration'))).toBe(false)
  })
})

describe('deleteScripts', () => {
  it('refuses to delete content type paths outside the migrations directory', async () => {
    fs.mkdirSync(migrationsDirectory, { recursive: true })
    const outside = path.join(root, 'outside')
    fs.mkdirSync(outside)

    await expect(deleteScripts(migrationsDirectory, ['../outside'])).rejects.toThrow(/Refusing to delete/)
    expect(fs.existsSync(outside)).toBe(true)
  })
})

describe('bootstrap', () => {
  const seedExisting = (): string => {
    const existing = path.join(migrationsDirectory, 'blogPost', '20190101000000-existing.js')
    fs.mkdirSync(path.dirname(existing), { recursive: true })
    fs.writeFileSync(existing, '// hand-written migration')
    return existing
  }

  it('keeps existing migrations when generation fails', async () => {
    const existing = seedExisting()
    mocks.contentTypeGetMany.mockRejectedValue(new Error('network down'))

    await expect(bootstrap({ ...connection, contentTypes: [], migrationsDirectory, writeMigrationState: true }))
      .rejects.toThrow('network down')

    expect(fs.readFileSync(existing, 'utf8')).toBe('// hand-written migration')
    expect(mocks.writeState).not.toHaveBeenCalled()
    // the temporary directory is cleaned up
    expect(fs.readdirSync(root)).toEqual(['migrations'])
  })

  it('keeps existing migrations when fetching an editor interface fails part-way', async () => {
    const existing = seedExisting()
    mocks.contentTypeGetMany.mockImplementation(paginate([contentType('blogPost'), contentType('author')]))
    mocks.editorInterfaceGet.mockImplementation(async ({ contentTypeId }: { contentTypeId: string }) => {
      if (contentTypeId === 'author') throw new Error('rate limited')
      return { controls: [] }
    })

    await expect(bootstrap({ ...connection, contentTypes: [], migrationsDirectory, writeMigrationState: false }))
      .rejects.toThrow('rate limited')

    expect(listFiles(migrationsDirectory)).toEqual(['blogPost', path.join('blogPost', '20190101000000-existing.js')])
    expect(fs.existsSync(existing)).toBe(true)
  })

  it('replaces only the selected content types and leaves others untouched', async () => {
    seedExisting()
    const other = path.join(migrationsDirectory, 'author', '20190101000000-author.js')
    fs.mkdirSync(path.dirname(other), { recursive: true })
    fs.writeFileSync(other, '// keep me')
    mocks.contentTypeGetMany.mockImplementation(paginate([contentType('blogPost'), contentType('author')]))

    await bootstrap({ ...connection, contentTypes: ['blogPost'], migrationsDirectory, writeMigrationState: false })

    const blogPostFiles = fs.readdirSync(path.join(migrationsDirectory, 'blogPost'))
    expect(blogPostFiles).toHaveLength(1)
    expect(blogPostFiles[0]).toMatch(/^\d{14}-create-blog-post\.js$/)
    expect(fs.readFileSync(other, 'utf8')).toBe('// keep me')
    expect(mocks.writeState).not.toHaveBeenCalled()
  })

  it('awaits the remote state rewrite before resolving', async () => {
    mocks.contentTypeGetMany.mockImplementation(paginate([contentType('blogPost')]))
    let finished = false
    mocks.writeState.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      finished = true
    })

    await bootstrap({ ...connection, contentTypes: [], migrationsDirectory, writeMigrationState: true })

    expect(finished).toBe(true)
    expect(mocks.newStore).toHaveBeenCalledWith('blogPost')
    const [state] = mocks.writeState.mock.calls[0] as [{ lastRun: string, migrations: Array<{ title: string }> }]
    expect(state.lastRun).toMatch(/-create-blog-post\.js$/)
    expect(state.migrations[0].title).toBe(state.lastRun)
  })

  it('rejects when the remote state rewrite fails', async () => {
    mocks.contentTypeGetMany.mockImplementation(paginate([contentType('blogPost')]))
    mocks.writeState.mockRejectedValue(new Error('write failed'))

    await expect(bootstrap({ ...connection, contentTypes: [], migrationsDirectory, writeMigrationState: true }))
      .rejects.toThrow('write failed')
  })

  it('rejects unsafe content type names before touching the filesystem', async () => {
    const existing = seedExisting()
    const outside = path.join(root, 'outside')
    fs.mkdirSync(outside)
    mocks.contentTypeGetMany.mockImplementation(paginate([contentType('blogPost')]))

    await expect(bootstrap({
      ...connection,
      contentTypes: ['../outside'],
      migrationsDirectory,
      writeMigrationState: false
    })).rejects.toThrow()

    expect(fs.existsSync(outside)).toBe(true)
    expect(fs.existsSync(existing)).toBe(true)
  })

  it('succeeds with no matching content types without crashing', async () => {
    mocks.contentTypeGetMany.mockImplementation(paginate([contentType('migration')]))

    await expect(bootstrap({ ...connection, contentTypes: ['missing'], migrationsDirectory, writeMigrationState: false }))
      .resolves.toBeUndefined()
  })
})
