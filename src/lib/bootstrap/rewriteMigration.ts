import log from 'migrate/lib/log'
import { createStoreFactory } from '../store'
import type { GeneratedScript } from './createFile'

const rewriteMigration = async (
  accessToken: string,
  spaceId: string,
  environmentId: string,
  files: GeneratedScript[]
): Promise<void> => {
  const factory = await createStoreFactory({ accessToken, environmentId, spaceId })

  await Promise.all(files.map(async (file) => {
    const { contentTypeId, fileName } = file
    const set = {
      lastRun: fileName,
      migrations: [{
        title: fileName,
        timestamp: Date.now(),
        description: `Create content model for ${contentTypeId}`
      }]
    }
    const store = factory.newStore(contentTypeId)
    await store.writeState(set)
    log('Wrote contentful migration state', contentTypeId)
  }))
}

export default rewriteMigration
