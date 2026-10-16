import { promisify } from 'node:util'
import chalk from 'chalk'
import runMigrations from 'migrate/lib/migrate'
import log from 'migrate/lib/log'
import load, { type ContentfulMigrationSet } from '../lib/load'
import { mapWithConcurrency } from '../lib/utils'
import { addConnectionOptions, addContentTypeOptions, resolveMigrationsDirectory, type ConnectionArgs, type ContentTypeArgs } from './options'
import type { Argv, ArgumentsCamelCase } from 'yargs'

export const command = 'up [file]'

export const desc =
  'Migrate up to a give migration or all pending if not specified'

interface UpArgs extends ConnectionArgs, ContentTypeArgs {
  dryRun?: boolean
  file?: string
}

export const builder = (yargs: Argv<UpArgs>) =>
  addContentTypeOptions(addConnectionOptions(yargs))
    .option('dry-run', {
      alias: 'd',
      describe: 'only shows the planned actions, don\'t write anything to Contentful',
      boolean: true,
      default: false
    })
    .positional('file', {
      describe: 'If specified, applies all pending migrations scripts up to this one.',
      type: 'string'
    })
    .check((argv) => {
      if (argv.all && argv.file) {
        return '[file] cannot be specified together with \'all\' option'
      }
      return true
    })

const runMigrationsAsync = promisify(runMigrations) as unknown as
  (set: ContentfulMigrationSet, direction: 'up' | 'down', migrationName?: string | null) => Promise<void>

export const handler = async (
  { accessToken, contentType, dryRun, environmentId, file, spaceId }: ArgumentsCamelCase<UpArgs>
): Promise<void> => {
  const migrationsDirectory = resolveMigrationsDirectory()

  const processSet = async (set: ContentfulMigrationSet): Promise<void> => {
    console.log(chalk.bold.blue('Processing'), set.store.contentTypeID)
    await runMigrationsAsync(set, 'up', file)
    log('All migrations applied for', `${set.store.contentTypeID}`)
  }

  // Load in migrations
  const sets = await load({
    accessToken,
    contentTypes: contentType,
    dryRun,
    environmentId,
    migrationsDirectory,
    spaceId
  })

  // TODO concurrency can be an cmdline option? I set it to 1 for now to make logs more readable
  try {
    await mapWithConcurrency(sets, set => set.then(processSet), 1)

    console.log(chalk.bold.yellow(`\n🎉  All content types in ${environmentId} are up-to-date`))
  } catch (error) {
    log.error('error', error)

    console.log(chalk.bold.red(`\n🚨  Error applying migrations to "${environmentId}" environment! See above for error messages`))
    process.exit(1)
  }
}
