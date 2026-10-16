import type { Argv, ArgumentsCamelCase } from 'yargs'
import { initSpace } from '../lib/store'
import { addConnectionOptions, type ConnectionArgs } from './options'

export const command = 'init'

export const desc =
  'Prepares the specified space to allow managed migration scripts.\nThe "Migration" content-type will be created in your contentful space'

export const builder = (yargs: Argv<ConnectionArgs>) =>
  addConnectionOptions(yargs)

export const handler = async (
  { accessToken, spaceId, environmentId }: ArgumentsCamelCase<ConnectionArgs>
): Promise<void> => {
  console.warn('init writes the Migration content type to the selected Contentful space/environment')
  await initSpace(accessToken, spaceId, environmentId)
}
