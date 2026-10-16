import path from 'node:path'
import chalk from 'chalk'
import log from 'migrate/lib/log'
import generator from 'migrate/lib/template-generator'
import type { Argv, ArgumentsCamelCase } from 'yargs'

export const command = 'create <name>'

export const desc =
  'Creates an empty time stamped file in the content-type\'s migrations folder'

interface CreateArgs {
  name: string
  contentType: string
}

export const builder = (yargs: Argv<CreateArgs>) => yargs
  .option('content-type', {
    alias: 'c',
    describe: 'content type name',
    type: 'string',
    requiresArg: true,
    demandOption: true
  })
  .positional('name', {
    describe: 'descriptive name for the migration file',
    type: 'string'
  })

export const handler = ({ name, contentType }: ArgumentsCamelCase<CreateArgs>): void => {
  const migrationsDirectory = process.env.CONTENTFUL_MIGRATIONS_DIR
    ? path.join(process.env.CONTENTFUL_MIGRATIONS_DIR, contentType)
    : path.join('.', 'migrations', contentType)

  const templateFile = path.join(__dirname, '..', '..', 'templates', 'migration.js')

  generator({
    name,
    templateFile,
    migrationsDirectory,
    dateFormat: 'UTC:yyyymmddHHMMss',
    extension: '.js'
  }, (error, filename) => {
    if (error) {
      log(chalk.bold.red(`🚨 Template generation error ${error.message}`))
      process.exit(1)
    }
    log('🎉 created', filename)
  })
}
