import { createClient, type ContentTypeProps, type PlainClientAPI } from 'contentful-management'
import chalk from 'chalk'
import log from 'migrate/lib/log'
import createFile, { type GeneratedScript } from './createFile'
import { jsonToScript } from './jsonToScript'
import { mapWithConcurrency } from '../utils'
import type { Control } from './jsonToScript'

// Magic number to prevent overloading the contentful management API.
// TODO: pass in from bootstrap command as an option
const CONCURRENCY = 5
const PAGE_LIMIT = 1000
const MIGRATION_CONTENT_TYPE = 'migration'

export interface GenerateScriptsOptions {
  accessToken: string
  spaceId: string
  environmentId: string
  contentTypes: string[]
  migrationsDirectory: string
}

interface GetPageParams {
  spaceId: string
  environmentId: string
}

/** Fetches every content type of the environment, following skip/limit pagination. */
const fetchAllContentTypes = async (
  client: PlainClientAPI,
  params: GetPageParams
): Promise<ContentTypeProps[]> => {
  const contentTypes: ContentTypeProps[] = []
  let total = Infinity
  while (contentTypes.length < total) {
    const page = await client.contentType.getMany({
      ...params,
      query: { limit: PAGE_LIMIT, skip: contentTypes.length }
    })
    total = page.total
    if (page.items.length === 0) break // avoid looping if the API misbehaves
    contentTypes.push(...page.items)
  }
  return contentTypes
}

const generateScripts = async ({
  accessToken,
  spaceId,
  environmentId,
  contentTypes,
  migrationsDirectory
}: GenerateScriptsOptions): Promise<GeneratedScript[]> => {
  const client: PlainClientAPI = createClient({ accessToken })
  const allContentTypes = await fetchAllContentTypes(client, { spaceId, environmentId })
  let requiredContentTypes = allContentTypes.filter(item => item.sys.id !== MIGRATION_CONTENT_TYPE)
  if (contentTypes.length > 0) {
    const contentTypesSet = new Set(contentTypes)
    requiredContentTypes = requiredContentTypes.filter(item => contentTypesSet.has(item.sys.id))
  }
  const mapper = async (contentType: typeof requiredContentTypes[number]): Promise<GeneratedScript> => {
    const contentTypeId = contentType.sys.id
    const editorInterface = await client.editorInterface.get({ spaceId, environmentId, contentTypeId })
    return createFile(
      contentTypeId,
      jsonToScript(contentType, (editorInterface.controls ?? []) as Control[]),
      migrationsDirectory
    )
  }

  const files = await mapWithConcurrency(requiredContentTypes, mapper, CONCURRENCY)
  log(chalk.bold.green('🎉  Scripts generation'), chalk.bold.green('successful'))
  return files
}

export default generateScripts
