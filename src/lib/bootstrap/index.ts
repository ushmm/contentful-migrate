import fs from 'node:fs'
import path from 'node:path'
import chalk from 'chalk'
import log from 'migrate/lib/log'
import generateScripts, { type GenerateScriptsOptions } from './generateScripts'
import deleteScripts from './deleteScripts'
import rewriteMigration from './rewriteMigration'

const logError = log.error

export interface BootstrapOptions extends GenerateScriptsOptions {
  writeMigrationState: boolean
}

/**
 * Moves generated scripts from the temporary directory into the migrations
 * directory, replacing anything already there.
 */
const moveScripts = async (tempDirectory: string, migrationsDirectory: string): Promise<void> => {
  const root = path.resolve(migrationsDirectory)
  await fs.promises.mkdir(root, { recursive: true })
  // Nothing was generated (e.g. no matching content types); leave the
  // freshly cleaned migrations directory empty instead of crashing on ENOENT.
  if (!fs.existsSync(tempDirectory)) return
  const entries = await fs.promises.readdir(tempDirectory, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const source = path.join(tempDirectory, entry.name)
    const target = path.join(root, entry.name)
    await fs.promises.rm(target, { recursive: true, force: true })
    await fs.promises.rename(source, target)
  }
}

/**
 * Regenerates migration scripts for existing content types and optionally
 * rewrites the remote migration state so future runs treat them as applied.
 *
 * Scripts are generated into a temporary directory first: if generation fails,
 * the existing migration scripts are left untouched.
 */
const bootstrap = async ({
  accessToken,
  spaceId,
  environmentId,
  contentTypes,
  migrationsDirectory,
  writeMigrationState
}: BootstrapOptions): Promise<void> => {
  const tempDirectory = `${path.resolve(migrationsDirectory)}.bootstrap-${process.pid}-${Date.now()}`
  try {
    const files = await generateScripts({
      accessToken,
      spaceId,
      environmentId,
      contentTypes,
      migrationsDirectory: tempDirectory
    })
    await deleteScripts(migrationsDirectory, contentTypes)
    await moveScripts(tempDirectory, migrationsDirectory)
    if (writeMigrationState) {
      await rewriteMigration(accessToken, spaceId, environmentId, files)
    }
    log(chalk.bold.green('🎉  Bootstrap'), chalk.bold.green('successful'))
  } catch (error) {
    logError('🚨  Failed to perform bootstrap', error)
    throw error
  } finally {
    await fs.promises.rm(tempDirectory, { recursive: true, force: true }).catch(() => {})
  }
}

export default bootstrap
