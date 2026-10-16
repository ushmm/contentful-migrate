import runMigrations from 'migrate/lib/migrate'
import log from 'migrate/lib/log'
import load, { type ContentfulMigrationSet } from '../lib/load'
import { addConnectionOptions, resolveMigrationsDirectory, type ConnectionArgs } from './options'
import type { Argv, ArgumentsCamelCase } from 'yargs'

export const command = 'down [file]'

export const desc =
  'Migrate down to a given migration or just the last one if not specified'

interface DownArgs extends ConnectionArgs {
  contentType: string
  dryRun?: boolean
  file?: string
}

export const builder = (yargs: Argv<DownArgs>) =>
  addConnectionOptions(yargs)
    .option('content-type', {
      alias: 'c',
      describe: 'single content type name to process',
      type: 'string',
      requiresArg: true,
      demandOption: true
    })
    .option('dry-run', {
      alias: 'd',
      describe: 'only shows the planned actions, don\'t write anything to Contentful',
      boolean: true,
      default: false
    })
    .positional('file', {
      describe: 'If specified, rollback all migrations scripts down to this one.',
      type: 'string'
    })

export const handler = async (
  { accessToken, contentType, dryRun, environmentId, file, spaceId }: ArgumentsCamelCase<DownArgs>
): Promise<void> => {
  const migrationsDirectory = resolveMigrationsDirectory()
  if (Array.isArray(contentType)) throw new Error('Specify exactly one content type for down')

  const processSet = (set: ContentfulMigrationSet): Promise<void> => new Promise((resolve, reject) => {
    runMigrations(set, 'down', file || set.lastRun, (error) => {
      if (error) return reject(error)
      log('migration', 'complete')
      resolve()
    })
  })

  // Load in migrations
  const sets = await load({
    migrationsDirectory,
    spaceId,
    environmentId,
    accessToken,
    dryRun,
    contentTypes: [contentType]
  })

  for (const set of sets) {
    await processSet(await set)
  }
}
