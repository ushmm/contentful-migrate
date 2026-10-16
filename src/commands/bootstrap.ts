import path from 'node:path'
import readline from 'node:readline/promises'
import chalk from 'chalk'
import bootstrap from '../lib/bootstrap'
import {
  addConnectionOptions, addContentTypeOptions, resolveMigrationsDirectory,
  type ConnectionArgs, type ContentTypeArgs
} from './options'
import type { Argv, ArgumentsCamelCase } from 'yargs'

export const command = 'bootstrap'
export const desc = 'Takes a snapshot of existing space and generates migration scripts'
type BootstrapArgs = ConnectionArgs & ContentTypeArgs

export const builder = (yargs: Argv<BootstrapArgs>) =>
  addContentTypeOptions(addConnectionOptions(yargs))

const isYes = (response: string): boolean => /^\s*(?:y|yes)\s*$/i.test(response)

export const handler = async (
  { environmentId, spaceId, contentType, accessToken }: ArgumentsCamelCase<BootstrapArgs>
): Promise<void> => {
  const migrationsDirectory = path.resolve(resolveMigrationsDirectory())
  const selection = contentType.length ? contentType.join(', ') : 'ALL content types'
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.warn(`Bootstrap target: ${spaceId}/${environmentId}; ${selection}`)
    const replace = await rl.question(chalk.yellow(
      `Replace local migration scripts in ${migrationsDirectory}? Back up existing scripts first. y/N: `
    ))
    if (!isYes(replace)) return
    const rewrite = await rl.question(chalk.yellow(
      `Also overwrite remote migration state for ${selection} in ${spaceId}/${environmentId}? y/N: `
    ))
    await bootstrap({
      accessToken,
      spaceId,
      environmentId,
      contentTypes: contentType,
      migrationsDirectory,
      writeMigrationState: isYes(rewrite)
    })
  } finally {
    rl.close()
  }
}
