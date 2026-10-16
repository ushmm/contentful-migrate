import { createClient, type PlainClientAPI } from 'contentful-management'
import run from './run'
import type { MigrationFunction } from './run'

export interface MigrationRecord {
  title: string
  description?: string
  timestamp: number | null
}

export interface MigrationSetLike {
  lastRun?: string | null
  migrations: MigrationRecord[]
}

export interface StoredState {
  lastRun?: string | null
  migrations: MigrationRecord[]
}

export interface ConnectionOptions {
  accessToken: string
  spaceId: string
  environmentId: string
}

type MigrationEntryFields = {
  contentTypeId: Record<string, string>
  state: Record<string, StoredState>
}

const MIGRATION_CONTENT_TYPE = 'migration'
const PAGE_LIMIT = 1000

const createPlainClient = (accessToken: string): PlainClientAPI => createClient({ accessToken })

/**
 * Caches are keyed by space/environment so that different targets in the same
 * process never share locale or state data.
 */
const defaultLocaleCache = new Map<string, Promise<string>>()
const stateCache = new Map<string, Promise<Record<string, StoredState>>>()

const cacheKey = ({ spaceId, environmentId }: { spaceId: string, environmentId: string }): string =>
  `${spaceId}/${environmentId}`

/** Clears cached locales and state. Intended for tests and long-lived processes. */
export const clearCaches = (): void => {
  defaultLocaleCache.clear()
  stateCache.clear()
}

export const getDefaultLocale = (
  { accessToken, spaceId, environmentId }: ConnectionOptions,
  client: PlainClientAPI = createPlainClient(accessToken)
): Promise<string> => {
  const key = cacheKey({ spaceId, environmentId })
  let cached = defaultLocaleCache.get(key)
  if (!cached) {
    cached = client.locale.getMany({ spaceId, environmentId, query: { limit: PAGE_LIMIT } })
      .then((response) => {
        const locale = response.items.find(item => item.default)
        if (!locale) {
          throw new Error(`No default locale found for space ${spaceId} environment ${environmentId}`)
        }
        return locale.code
      })
    cached.catch(() => defaultLocaleCache.delete(key))
    defaultLocaleCache.set(key, cached)
  }
  return cached
}

export const fetchAllStates = async (
  { spaceId, environmentId }: { spaceId: string, environmentId: string },
  locale: string,
  client: PlainClientAPI
): Promise<Record<string, StoredState>> => {
  const states: Record<string, StoredState> = {}
  let skip = 0
  let total = Infinity
  while (skip < total) {
    const page = await client.entry.getMany<MigrationEntryFields>({
      spaceId,
      environmentId,
      query: { content_type: MIGRATION_CONTENT_TYPE, limit: PAGE_LIMIT, skip }
    })
    for (const entry of page.items) {
      const contentType = entry.fields.contentTypeId?.[locale]
      const state = entry.fields.state?.[locale]
      if (contentType && state) {
        states[contentType] = state
      }
    }
    total = page.total
    skip += page.items.length
    if (page.items.length === 0) break
  }
  return states
}

const initializeStoreStates = (
  options: ConnectionOptions,
  locale: string,
  client: PlainClientAPI
): Promise<Record<string, StoredState>> => {
  const key = cacheKey(options)
  let cached = stateCache.get(key)
  if (!cached) {
    cached = fetchAllStates(options, locale, client)
    cached.catch(() => stateCache.delete(key))
    stateCache.set(key, cached)
  }
  return cached
}

export const migrationContentTypeDefinition: MigrationFunction = (migration) => {
  const contentType = migration.createContentType(MIGRATION_CONTENT_TYPE)
    .name('Migration')
    .displayField('contentTypeId')
    .description('Meta data to store the state of content model through migrations')

  contentType.createField('state')
    .name('Migration State')
    .type('Object')
    .required(true)

  contentType.createField('contentTypeId')
    .name('Content Type ID')
    .type('Symbol')
    .required(true)
    .validations([{ unique: true }])
}

export const initSpace = (accessToken: string, spaceId: string, environmentId?: string): Promise<void> =>
  run({
    spaceId,
    environmentId: environmentId || 'master',
    accessToken,
    dryRun: false,
    migrationFunction: migrationContentTypeDefinition
  })

export interface ContentfulStoreOptions extends ConnectionOptions {
  contentType: string
  locale: string
  dryRun?: boolean
  state?: StoredState
  client?: PlainClientAPI
}

type LoadCallback = (err: Error | null, state?: StoredState | Record<string, never>) => void
type SaveCallback = (err?: Error | null) => void

/** A node-migrate state store backed by a Contentful `migration` entry per content type. */
export class ContentfulStore {
  readonly spaceId: string
  readonly environmentId: string
  readonly accessToken: string
  readonly contentTypeID: string
  readonly locale: string
  readonly dryRun: boolean
  private state?: StoredState
  private clientInstance?: PlainClientAPI

  constructor ({
    spaceId, environmentId, contentType, accessToken, dryRun, locale, state, client
  }: ContentfulStoreOptions) {
    this.spaceId = spaceId
    this.environmentId = environmentId
    this.accessToken = accessToken
    this.contentTypeID = contentType
    this.locale = locale
    this.dryRun = Boolean(dryRun)
    this.state = state
    this.clientInstance = client
  }

  get client (): PlainClientAPI {
    if (!this.clientInstance) {
      this.clientInstance = createPlainClient(this.accessToken)
    }
    return this.clientInstance
  }

  private get params () {
    return { spaceId: this.spaceId, environmentId: this.environmentId }
  }

  createStateFrom (set: MigrationSetLike): Record<string, StoredState> {
    const migrations = set.migrations
      .filter(m => m.timestamp)
      .map(({ title, description, timestamp }) => ({ title, description, timestamp }))
    return {
      [this.locale]: {
        lastRun: set.lastRun,
        migrations
      }
    }
  }

  isSetEmpty (set: MigrationSetLike): boolean {
    return set.migrations.filter(m => m.timestamp).length === 0
  }

  private updateCachedState (state?: StoredState): void {
    this.state = state
    stateCache.delete(cacheKey(this))
  }

  async deleteState (): Promise<void> {
    try {
      await this.client.entry.delete({ ...this.params, entryId: this.contentTypeID })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    this.updateCachedState()
  }

  async writeState (set: MigrationSetLike): Promise<void> {
    if (this.isSetEmpty(set)) {
      return this.deleteState()
    }
    const state = this.createStateFrom(set)
    const existing = await this.client.entry.getMany<MigrationEntryFields>({
      ...this.params,
      query: { content_type: MIGRATION_CONTENT_TYPE, 'fields.contentTypeId': this.contentTypeID, limit: 1 }
    })
    if (existing.total === 0 || existing.items.length === 0) {
      await this.client.entry.createWithId<MigrationEntryFields>(
        { ...this.params, entryId: this.contentTypeID, contentTypeId: MIGRATION_CONTENT_TYPE },
        {
          fields: {
            contentTypeId: { [this.locale]: this.contentTypeID },
            state
          }
        }
      )
      this.updateCachedState(state[this.locale])
      return
    }
    const entry = existing.items[0]
    await this.client.entry.update<MigrationEntryFields>(
      { ...this.params, entryId: entry.sys.id },
      { ...entry, fields: { ...entry.fields, state: { ...entry.fields.state, ...state } } }
    )
    this.updateCachedState(state[this.locale])
  }

  save (set: MigrationSetLike, fn: SaveCallback): void {
    if (this.dryRun) {
      fn()
      return
    }
    this.writeState(set)
      .then(() => fn(), (error: Error) => fn(error))
  }

  load (fn: LoadCallback): void {
    fn(null, this.state ?? {})
  }

  init (): Promise<void> {
    return initSpace(this.accessToken, this.spaceId, this.environmentId)
  }
}

const isNotFound = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const { name, status, message } = error as { name?: string, status?: number, message?: string }
  if (name === 'NotFound' || status === 404) return true
  try {
    return JSON.parse(String(message)).status === 404
  } catch {
    return false
  }
}

export interface StoreFactory {
  locale: string
  newStore (contentType: string): ContentfulStore
}

export const createStoreFactory = async ({
  accessToken, spaceId, environmentId, dryRun, client = createPlainClient(accessToken)
}: ConnectionOptions & { dryRun?: boolean, client?: PlainClientAPI }): Promise<StoreFactory> => {
  const connection = { accessToken, spaceId, environmentId }
  const locale = await getDefaultLocale(connection, client)
  const states = await initializeStoreStates(connection, locale, client)

  return {
    locale,
    newStore: contentType => new ContentfulStore({
      ...connection,
      contentType,
      dryRun,
      locale,
      state: states[contentType],
      client
    })
  }
}
