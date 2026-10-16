import { describe, it, expect, beforeEach } from 'vitest'
import type { PlainClientAPI } from 'contentful-management'
import {
  ContentfulStore,
  clearCaches,
  createStoreFactory,
  fetchAllStates,
  getDefaultLocale,
  type MigrationSetLike,
  type StoredState
} from '../store'

const set: MigrationSetLike = JSON.parse(`
{
  "migrations": [
    {
      "title": "20180822174241-test_111.js",
      "description": "This is a test",
      "timestamp": 1534959835497
    },
    {
      "title": "20180822174242-test_222.js",
      "description": "This is a another test",
      "timestamp": 1534959835497
    }
  ],
  "lastRun": "20180822174241-test_222.js"
}`)

const connection = { accessToken: 'token', spaceId: 'space-id', environmentId: 'master' }

interface MockClientOptions {
  states?: Record<string, StoredState>
}

interface MockClient {
  client: PlainClientAPI
  calls: Record<string, unknown[][]>
}

/** Builds a minimal async fake of the plain client surface the store uses. */
const createMockClient = ({ states = {} }: MockClientOptions = {}): MockClient => {
  const calls: Record<string, unknown[][]> = {
    'locale.getMany': [],
    'entry.getMany': [],
    'entry.update': [],
    'entry.createWithId': [],
    'entry.delete': []
  }
  const record = (name: string) => (...args: any[]): void => {
    calls[name].push(args)
  }
  const client = {
    locale: {
      getMany: (params: unknown): Promise<any> => {
        record('locale.getMany')(params)
        return Promise.resolve({ items: [{ code: 'en-US', default: true }] })
      }
    },
    entry: {
      getMany: (params: any): Promise<any> => {
        record('entry.getMany')(params)
        const items = Object.entries(states).map(([contentTypeId, state]) => ({
          sys: { id: contentTypeId },
          fields: {
            contentTypeId: { 'en-US': contentTypeId },
            state: { 'en-US': state }
          }
        }))
        return Promise.resolve({ items, total: items.length })
      },
      update: (...args: any[]): Promise<any> => {
        record('entry.update')(...args)
        return Promise.resolve({})
      },
      createWithId: (...args: any[]): Promise<any> => {
        record('entry.createWithId')(...args)
        return Promise.resolve({})
      },
      delete: (...args: any[]): Promise<any> => {
        record('entry.delete')(...args)
        return Promise.resolve({})
      }
    }
  }
  return { client: client as unknown as PlainClientAPI, calls }
}

const createStore = (overrides: Partial<ConstructorParameters<typeof ContentfulStore>[0]> = {}): ContentfulStore => {
  const options = {
    accessToken: 'token',
    spaceId: 'space-id',
    environmentId: 'master',
    contentType: 'test',
    locale: 'en-US',
    ...overrides
  }
  return new ContentfulStore(options as ConstructorParameters<typeof ContentfulStore>[0])
}

const saveAsync = (store: ContentfulStore, migrationSet: MigrationSetLike): Promise<void> =>
  new Promise((resolve, reject) => {
    store.save(migrationSet, (error) => (error ? reject(error) : resolve()))
  })

beforeEach(() => {
  clearCaches()
})

describe('ContentfulStore', () => {
  describe('isSetEmpty', () => {
    const store = createStore()

    it('should return false whem set is not empty', () => {
      expect(store.isSetEmpty(set)).toBe(false)
    })

    it('should return true whem set is empty', () => {
      const emptySet = { migrations: [], lastRun: '' }

      expect(store.isSetEmpty(emptySet)).toBe(true)
    })
  })

  describe('createStateFrom', () => {
    describe('with a fully applied set', () => {
      const store = createStore()
      const state = store.createStateFrom(set)

      it('should format the state as a Contentful object', () => {
        expect(state).toHaveProperty('en-US')
      })

      it('should include lastRun info', () => {
        expect(state['en-US']).toHaveProperty('lastRun')
        expect(state['en-US']?.lastRun).toBe('20180822174241-test_222.js')
      })

      it('should include all applied migrations', () => {
        expect(state['en-US']?.migrations).toHaveLength(2)
      })
    })

    describe('with a set with pending migrations', () => {
      const setWithPendingMigrations = {
        migrations: [
          {
            title: '20180822174241-test_111.js',
            description: 'This is a test',
            timestamp: 1534959835497
          },
          {
            title: '20180822174242-test_222.js',
            description: 'This is a another test',
            timestamp: null
          }
        ],
        lastRun: '20180822174241-test_222.js'
      }
      const store = createStore()
      const state = store.createStateFrom(setWithPendingMigrations)

      it('should filter out pending migrations from set', () => {
        expect(state['en-US']?.migrations).toHaveLength(1)
      })
    })
  })

  describe('load', () => {
    it('returns the state passed to the constructor', () => {
      const state = { lastRun: '20180822174241-test_222.js', migrations: [] }
      const store = createStore({ state })

      const loaded: Array<unknown> = []
      store.load((error, loadedState) => {
        expect(error).toBeNull()
        loaded.push(loadedState)
      })
      expect(loaded[0]).toBe(state)
    })

    it('returns an empty object when no state was injected', () => {
      const store = createStore()
      store.load((error, loadedState) => {
        expect(error).toBeNull()
        expect(loadedState).toEqual({})
      })
    })
  })

  describe('save', () => {
    it('is a no-op in dry-run mode and never touches the client', async () => {
      const { client, calls } = createMockClient()
      const store = createStore({ dryRun: true, client })

      await saveAsync(store, set)

      expect(calls['entry.getMany']).toHaveLength(0)
      expect(calls['entry.createWithId']).toHaveLength(0)
      expect(calls['entry.update']).toHaveLength(0)
      expect(calls['entry.delete']).toHaveLength(0)
    })

    it('creates a migration entry when none exists on the space yet', async () => {
      const { client, calls } = createMockClient()
      const store = createStore({ client })

      await saveAsync(store, set)

      // createWithId targets the managed entry id equal to the content type id
      expect(calls['entry.createWithId']).toHaveLength(1)
      const [createParams, createPayload] = calls['entry.createWithId'][0] as any[]
      expect(createParams.entryId).toBe('test')
      expect(createParams.contentTypeId).toBe('migration')
      expect(createPayload.fields.contentTypeId).toEqual({ 'en-US': 'test' })
      expect(createPayload.fields.state['en-US'].lastRun).toBe('20180822174241-test_222.js')
    })

    it('updates the existing migration entry instead of creating a new one', async () => {
      const existingState = {
        lastRun: '20180822174241-test_111.js',
        migrations: set.migrations.slice(0, 1)
      }
      const { client, calls } = createMockClient({ states: { test: existingState } })
      const store = createStore({ client })

      await saveAsync(store, set)

      expect(calls['entry.createWithId']).toHaveLength(0)
      expect(calls['entry.update']).toHaveLength(1)
      const [updateParams, updatePayload] = calls['entry.update'][0] as any[]
      expect(updateParams.entryId).toBe('test')
      expect(updatePayload.fields.state['en-US'].migrations).toHaveLength(2)
    })

    it('deletes the entry when the set is empty', async () => {
      const { client, calls } = createMockClient()
      const store = createStore({ client })

      await saveAsync(store, { migrations: [], lastRun: '' })

      expect(calls['entry.delete']).toHaveLength(1)
      const [deleteParams] = calls['entry.delete'][0] as any[]
      expect(deleteParams.entryId).toBe('test')
      expect(calls['entry.createWithId']).toHaveLength(0)
      expect(calls['entry.update']).toHaveLength(0)
    })
  })

  describe('persistence errors', () => {
    it('ignores a NotFound error when deleting state for a non-existent entry', async () => {
      const { client } = createMockClient()
      const store = createStore({ client })
      ;(client.entry as any).delete = () => Promise.reject(Object.assign(new Error('The resource could not be found.'), { name: 'NotFound' }))

      await expect(saveAsync(store, { migrations: [], lastRun: '' })).resolves.toBeUndefined()
    })

    it('ignores a 404 status error shaped like the Contentful management API response', async () => {
      const { client } = createMockClient()
      const store = createStore({ client })
      const notFoundBody = JSON.stringify({ status: 404 })
      ;(client.entry as any).delete = () => Promise.reject(new Error(notFoundBody))

      await expect(saveAsync(store, { migrations: [], lastRun: '' })).resolves.toBeUndefined()
    })

    it('propagates unexpected writeState errors back through the save callback', async () => {
      const { client } = createMockClient()
      const failure = new Error('boom')
      ;(client.entry as any).createWithId = () => Promise.reject(failure)
      const store = createStore({ client })

      await expect(saveAsync(store, set)).rejects.toBe(failure)
    })

    it('rethrows non-NotFound delete errors', async () => {
      const { client } = createMockClient()
      const failure = new Error('unauthorized')
      ;(client.entry as any).delete = () => Promise.reject(failure)
      const store = createStore({ client })

      await expect(saveAsync(store, { migrations: [], lastRun: '' })).rejects.toBe(failure)
    })
  })
})

describe('fetchAllStates', () => {
  it('returns the stored state keyed by content type id', async () => {
    const states = {
      test: { lastRun: 'x', migrations: [] },
      other: { lastRun: 'y', migrations: [] }
    }
    const { client } = createMockClient({ states })

    const fetched = await fetchAllStates({ spaceId: 's', environmentId: 'e' }, 'en-US', client)

    expect(fetched).toEqual(states)
  })

  it('pagination: collects entries across multiple pages', async () => {
    const firstPage = ['a', 'b'].map(id => ({
      sys: { id },
      fields: { contentTypeId: { 'en-US': id }, state: { 'en-US': { lastRun: id, migrations: [] } } }
    }))
    const secondPage = firstPage.slice(0, 1).map(item => ({ ...item, sys: { id: 'c' }, fields: { contentTypeId: { 'en-US': 'c' }, state: { 'en-US': { lastRun: 'c', migrations: [] } } } }))
    const client = {
      entry: {
        getMany: ({ query }: { query: { skip?: number } }): Promise<any> => {
          const skip = query.skip ?? 0
          if (skip === 0) return Promise.resolve({ items: firstPage, total: firstPage.length + secondPage.length })
          return Promise.resolve({ items: secondPage, total: firstPage.length + secondPage.length })
        }
      }
    } as unknown as PlainClientAPI

    const fetched = await fetchAllStates({ spaceId: 's', environmentId: 'e' }, 'en-US', client)

    expect(Object.keys(fetched).sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('getDefaultLocale', () => {
  it('resolves the default locale code for the space', async () => {
    const { client } = createMockClient()

    await expect(getDefaultLocale(connection, client)).resolves.toBe('en-US')
  })

  it('caches per space/environment and only calls the API once per key', async () => {
    const { client, calls } = createMockClient()

    await getDefaultLocale(connection, client)
    await getDefaultLocale(connection, client)

    expect(calls['locale.getMany']).toHaveLength(1)
  })

  it('does not share cache entries between different environments of the same space', async () => {
    const { client, calls } = createMockClient()

    await getDefaultLocale({ ...connection, environmentId: 'env-a' }, client)
    await getDefaultLocale({ ...connection, environmentId: 'env-b' }, client)

    expect(calls['locale.getMany']).toHaveLength(2)
  })

  it('drops failed resolutions from the cache so a later call retries', async () => {
    const { client } = createMockClient()
    let calls = 0
    ;(client.locale as any).getMany = () => {
      calls += 1
      return calls === 1
        ? Promise.reject(new Error('flaky'))
        : Promise.resolve({ items: [{ code: 'en-US', default: true }] })
    }

    await expect(getDefaultLocale(connection, client)).rejects.toThrow('flaky')
    await expect(getDefaultLocale(connection, client)).resolves.toBe('en-US')
  })

  it('throws when the space has no default locale', async () => {
    const client = {
      locale: { getMany: () => Promise.resolve({ items: [{ code: 'en-US', default: false }] }) }
    } as unknown as PlainClientAPI

    await expect(getDefaultLocale(connection, client)).rejects.toThrow(/No default locale found/)
  })
})

describe('createStoreFactory cache isolation', () => {
  it('caches store state separately for each space/environment pair', async () => {
    const statesByEnvironment: Record<string, Record<string, StoredState>> = {
      'env-a': { horse: { lastRun: 'a', migrations: [] } },
      'env-b': { horse: { lastRun: 'b', migrations: [] } }
    }
    const seenEnvironments: string[] = []
    const client = {
      locale: {
        getMany: () => Promise.resolve({ items: [{ code: 'en-US', default: true }] })
      },
      entry: {
        getMany: ({ environmentId }: { environmentId: string }): Promise<any> => {
          seenEnvironments.push(environmentId)
          const items = Object.entries(statesByEnvironment[environmentId]).map(([id, state]) => ({
            sys: { id },
            fields: { contentTypeId: { 'en-US': id }, state: { 'en-US': state } }
          }))
          return Promise.resolve({ items, total: items.length })
        },
        update: () => Promise.resolve({}),
        createWithId: () => Promise.resolve({}),
        delete: () => Promise.resolve({})
      }
    } as unknown as PlainClientAPI

    const factoryA = await createStoreFactory({ ...connection, environmentId: 'env-a', client })
    const factoryB = await createStoreFactory({ ...connection, environmentId: 'env-b', client })

    const storeA = factoryA.newStore('horse')
    const storeB = factoryB.newStore('horse')

    const loadState = (store: ContentfulStore): Promise<StoredState | Record<string, never>> =>
      new Promise((resolve, reject) => store.load((error, state) => (error ? reject(error) : resolve(state ?? {}))))

    expect(await loadState(storeA)).toEqual(statesByEnvironment['env-a'].horse)
    expect(await loadState(storeB)).toEqual(statesByEnvironment['env-b'].horse)

    // Same environment does not refetch state on a second factory
    await createStoreFactory({ ...connection, environmentId: 'env-a', client })
    expect(seenEnvironments.filter(e => e === 'env-a')).toHaveLength(1)
    expect(seenEnvironments.filter(e => e === 'env-b')).toHaveLength(1)
  })

  it('does not let a slow concurrent lookup for one environment contaminate another', async () => {
    let resolveSlowLocale: ((value: unknown) => void) | undefined
    const client = {
      locale: {
        getMany: ({ environmentId }: { environmentId: string }): Promise<any> => {
          if (environmentId === 'env-slow') {
            return new Promise((resolve) => { resolveSlowLocale = resolve })
          }
          return Promise.resolve({ items: [{ code: 'en-US', default: true }] })
        }
      },
      entry: {
        getMany: ({ environmentId }: { environmentId: string }): Promise<any> => {
          const locale = environmentId === 'env-slow' ? 'de-DE' : 'en-US'
          return Promise.resolve({
            items: [{
              sys: { id: 'horse' },
              fields: {
                contentTypeId: { [locale]: 'horse' },
                state: { [locale]: { lastRun: `run-${environmentId}`, migrations: [] } }
              }
            }],
            total: 1
          })
        },
        update: () => Promise.resolve({}),
        createWithId: () => Promise.resolve({}),
        delete: () => Promise.resolve({})
      }
    } as unknown as PlainClientAPI

    const slowFactoryPromise = createStoreFactory({ ...connection, environmentId: 'env-slow', client })
    const fastFactoryPromise = createStoreFactory({ ...connection, environmentId: 'env-fast', client })

    const fastFactory = await fastFactoryPromise
    expect(resolveSlowLocale).toBeDefined()
    resolveSlowLocale?.({ items: [{ code: 'de-DE', default: true }] })
    const slowFactory = await slowFactoryPromise

    // The fast factory must not pick up the slow environment's locale or state
    expect(fastFactory.locale).toBe('en-US')
    expect(slowFactory.locale).toBe('de-DE')

    const loadState = (store: ContentfulStore): Promise<StoredState | Record<string, never>> =>
      new Promise((resolve, reject) => store.load((error, state) => (error ? reject(error) : resolve(state ?? {}))))

    expect(await loadState(fastFactory.newStore('horse'))).toEqual({ lastRun: 'run-env-fast', migrations: [] })
    expect(await loadState(slowFactory.newStore('horse'))).toEqual({ lastRun: 'run-env-slow', migrations: [] })
  })
})
