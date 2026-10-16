import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { load as migrateLoad, type MigrationSet } from 'migrate'
import log from 'migrate/lib/log'
import { createStoreFactory, type ContentfulStore } from './store'
import runMigration, { type MigrationFunction } from './run'

export type ContentfulMigrationSet = MigrationSet & { store: ContentfulStore }

export interface LoadOptions {
  migrationsDirectory: string
  spaceId: string
  environmentId: string
  accessToken: string
  dryRun?: boolean
  contentTypes?: string[]
}

type NodeMigrateFn = (next: (err?: Error | null) => void) => void

const loadAsync = promisify(migrateLoad) as unknown as
  (opts: Parameters<typeof migrateLoad>[0]) => Promise<MigrationSet>

/** Wraps a Contentful migration function as a callback-style node-migrate function. */
export const wrapMigration = (
  migrationFunction: MigrationFunction,
  options: Omit<LoadOptions, 'migrationsDirectory' | 'contentTypes'>
): NodeMigrateFn => (next) => {
  runMigration({ ...options, migrationFunction })
    .then(() => next(), (error: Error) => next(error))
}

export const configureSet = (
  set: MigrationSet,
  options: Omit<LoadOptions, 'migrationsDirectory' | 'contentTypes'>
): ContentfulMigrationSet => {
  set.migrations.forEach((migration) => {
    if (migration.up) {
      migration.up = wrapMigration(migration.up as unknown as MigrationFunction, options)
    }
    if (migration.down) {
      migration.down = wrapMigration(migration.down as unknown as MigrationFunction, options)
    }
  })

  set.on('warning', (msg: string) => log('warning', msg))
  set.on('migration', (migration: { title: string }, direction: string) => log(direction, migration.title))

  return set as ContentfulMigrationSet
}

export const readContentTypes = (migrationsDirectory: string): string[] => {
  if (!fs.existsSync(migrationsDirectory)) return []
  return fs.readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

const isMigrationFile = (file: string): boolean => /\.(c?js|mjs)$/.test(file)

/** Loads one node-migrate set per content type directory. */
export const load = async ({
  migrationsDirectory,
  spaceId,
  environmentId,
  accessToken,
  dryRun,
  contentTypes
}: LoadOptions): Promise<Promise<ContentfulMigrationSet>[]> => {
  const contentTypeList = contentTypes && contentTypes.length > 0
    ? contentTypes
    : readContentTypes(migrationsDirectory)

  const factory = await createStoreFactory({ accessToken, dryRun, environmentId, spaceId })
  const runOptions = { spaceId, environmentId, accessToken, dryRun }

  return contentTypeList.map(async (contentType) => {
    const store = factory.newStore(contentType)
    const contentTypeDirectory = path.resolve(migrationsDirectory, contentType)
    const set = await loadAsync({
      stateStore: store as never,
      migrationsDirectory: contentTypeDirectory,
      filterFunction: isMigrationFile as never
    })
    return configureSet(set, runOptions)
  })
}

export default load
