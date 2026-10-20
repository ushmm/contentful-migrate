import path from 'node:path'
import type { Argv } from 'yargs'

export interface ConnectionArgs {
  accessToken: string
  spaceId: string
  environmentId: string
}

export const addConnectionOptions = <T>(yargs: Argv<T>) => yargs
  .option('access-token', {
    alias: 't',
    type: 'string',
    requiresArg: true,
    describe: 'Contentful Management API access token',
    demandOption: true,
    default: process.env.CONTENTFUL_MANAGEMENT_ACCESS_TOKEN,
    defaultDescription: 'environment var CONTENTFUL_MANAGEMENT_ACCESS_TOKEN'
  })
  .option('space-id', {
    alias: 's',
    describe: 'space id to use',
    type: 'string',
    requiresArg: true,
    demandOption: true,
    default: process.env.CONTENTFUL_SPACE_ID,
    defaultDescription: 'environment var CONTENTFUL_SPACE_ID'
  })
  .option('environment-id', {
    alias: 'e',
    describe: 'id of the environment within the space',
    type: 'string',
    requiresArg: true,
    default: process.env.CONTENTFUL_ENV_ID || 'master',
    defaultDescription: 'environment var CONTENTFUL_ENV_ID if exists, otherwise master'
  })

export interface ContentTypeArgs {
  contentType: string[]
  all?: boolean
}

export const addContentTypeOptions = <T>(yargs: Argv<T>) => yargs
  .option('content-type', {
    alias: 'c',
    describe: 'one or more content type names to process',
    array: true,
    type: 'string',
    requiresArg: true,
    default: [] as string[]
  })
  .option('all', {
    alias: 'a',
    describe: 'processes migrations for all content types',
    boolean: true
  })
  .check((argv: { all?: boolean, contentType?: string[] }) => {
    if (argv.all && argv.contentType && argv.contentType.length > 0) {
      return 'Arguments \'content-type\' and \'all\' are mutually exclusive'
    }
    if (!argv.all && (!argv.contentType || argv.contentType.length === 0)) {
      return 'At least one of \'all\' or \'content-type\' options must be specified'
    }
    return true
  })

export const resolveMigrationsDirectory = (): string =>
  process.env.CONTENTFUL_MIGRATIONS_DIR || path.join('.', 'migrations')
