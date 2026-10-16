import chalk from 'chalk'
import log from 'migrate/lib/log'
import load, { type ContentfulMigrationSet } from '../lib/load'
import { formatLocalDateTime } from '../lib/utils'
import { addConnectionOptions, addContentTypeOptions, resolveMigrationsDirectory, type ConnectionArgs, type ContentTypeArgs } from './options'
import type { Argv, ArgumentsCamelCase } from 'yargs'

export const command = 'list'

export const desc =
  'List all migrations for a given content-type, also indicating whether it was already applied and when'

type ListArgs = ConnectionArgs & ContentTypeArgs

export const builder = (yargs: Argv<ListArgs>) =>
  addContentTypeOptions(addConnectionOptions(yargs))

const listSet = (set: ContentfulMigrationSet): void => {
  console.log(chalk.bold.blue('Listing'), set.store.contentTypeID)
  if (set.migrations.length === 0) {
    log('list', 'No Migrations')
  }

  set.migrations.forEach((migration) => {
    log(
      (migration.timestamp
        ? `[${formatLocalDateTime(migration.timestamp)}] `
        : chalk.bold.yellow('[pending]             ')) + chalk.bold.white(migration.title),
      migration.description || '<No Description>'
    )
  })
}

export const handler = async (
  { spaceId, environmentId, contentType, accessToken }: ArgumentsCamelCase<ListArgs>
): Promise<void> => {
  const migrationsDirectory = resolveMigrationsDirectory()

  // Load in migrations
  const sets = await load({
    accessToken,
    contentTypes: contentType,
    dryRun: false,
    environmentId,
    migrationsDirectory,
    spaceId
  })

  for (const set of sets) {
    listSet(await set)
  }
}
