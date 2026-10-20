import path from 'node:path'
import fs from 'node:fs'
import log from 'migrate/lib/log'
import { camelToDash, formatUtcTimestamp } from '../utils'

const logError = log.error

export interface GeneratedScript {
  contentTypeId: string
  fileName: string
  filePath: string
}

const createFile = async (
  contentTypeId: string,
  fileContent: string,
  migrationsDirectory: string
): Promise<GeneratedScript> => {
  const directory = path.join(migrationsDirectory, contentTypeId)
  try {
    await fs.promises.mkdir(directory, { recursive: true })
    const fileName = `${formatUtcTimestamp()}-create-${camelToDash(contentTypeId)}.js`
    const filePath = path.join(directory, fileName)
    await fs.promises.writeFile(filePath, fileContent)
    log('Created', `${directory}/${fileName}`)
    return { contentTypeId, fileName, filePath }
  } catch (error) {
    logError(`🚨  Failed to create ${directory}`, error)
    throw error
  }
}

export default createFile
