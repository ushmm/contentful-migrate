import fs from 'node:fs'
import path from 'node:path'
import log from 'migrate/lib/log'

const logError = log.error

/** The resolved migrations directory must remain inside whatever root the caller pointed at. */
const resolveInside = (migrationsDirectory: string, contentType: string): string => {
  const root = path.resolve(migrationsDirectory)
  const contentTypeDirectory = path.resolve(root, contentType)
  if (contentTypeDirectory !== root && !contentTypeDirectory.startsWith(root + path.sep)) {
    throw new Error(`Refusing to delete path outside of ${root}: ${contentTypeDirectory}`)
  }
  return contentTypeDirectory
}

const removeDirectory = async (directory: string): Promise<void> => {
  try {
    await fs.promises.rm(directory, { recursive: true, force: true })
    log(`${directory} folder`, 'deleted')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logError('🚨   Failed to delete migrations folder', reason)
    throw error
  }
}

/**
 * Deletes generated migration scripts. When `contentTypes` is empty the whole
 * migrations directory is removed; refuse to delete anything outside of the
 * configured directory (e.g. when a content type name contains `..` or `/`).
 */
const deleteScripts = async (migrationsDirectory: string, contentTypes: string[]): Promise<void> => {
  if (contentTypes.length > 0) {
    await Promise.all(contentTypes.map(contentType =>
      removeDirectory(resolveInside(migrationsDirectory, contentType))
    ))
    return
  }
  await removeDirectory(path.resolve(migrationsDirectory))
}

export default deleteScripts
