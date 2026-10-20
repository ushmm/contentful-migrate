// Adapted from contentful-migration's runner (src/bin/cli.ts) to add dry-run support.
// It relies on private `contentful-migration/built/*` modules; see src/types/vendor.d.ts.

import path from 'node:path'
import chalk from 'chalk'
import { Listr } from 'listr2'
import type { MigrationFunction as ContentfulMigrationFunction } from 'contentful-migration'
import { createManagementClient } from 'contentful-migration/built/bin/lib/contentful-client'
import { SpaceAccessError } from 'contentful-migration/built/lib/errors'
import createMigrationParser from 'contentful-migration/built/lib/migration-parser'
import { renderPlan, renderRuntimeErrors, renderValidationErrors } from 'contentful-migration/built/bin/lib/render-migration'
import renderStepsErrors from 'contentful-migration/built/bin/lib/steps-errors'
import writeErrorsToLog from 'contentful-migration/built/bin/lib/write-errors-to-log'
import { createMakeRequest } from 'contentful-migration/built/bin/cli'
import { errorMessage } from './utils'

export type MigrationFunction = ContentfulMigrationFunction

export interface RunOptions {
  spaceId: string
  environmentId: string
  accessToken: string
  dryRun?: boolean
  migrationFunction: MigrationFunction
}

// Compiled to CommonJS, so `require` is available at runtime and resolves
// ../../package.json from both src/lib (vitest) and dist/lib (production).
const { version } = require('../../package.json') as { version: string }

export class MigrationError extends Error {
  readonly errors: unknown[]

  constructor (message: string, errors: unknown[] = []) {
    super(message)
    this.name = 'MigrationError'
    this.errors = errors
  }
}

export class BatchError extends MigrationError {
  readonly batch: unknown

  constructor (message: string, batch: unknown, errors: unknown[]) {
    super(message, errors)
    this.name = 'BatchError'
    this.batch = batch
  }
}

const parseRequestError = (error: unknown): Error => {
  try {
    const parsed = JSON.parse(errorMessage(error))
    return new Error(JSON.stringify({
      status: parsed.statusText,
      message: parsed.message,
      details: parsed.details,
      url: parsed.request?.url
    }))
  } catch {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Parses, validates, renders and (unless `dryRun`) executes a migration function.
 * Rejects with a MigrationError instead of exiting the process.
 */
export const runMigration = async ({
  spaceId, environmentId, accessToken, dryRun, migrationFunction
}: RunOptions): Promise<void> => {
  const clientConfig = {
    application: `contentful-migrate/${version}`,
    spaceId,
    environmentId,
    accessToken
  }
  const client = createManagementClient({ ...clientConfig })
  const makeRequest = createMakeRequest(client, { spaceId, environmentId })
  const migrationParser = createMigrationParser(makeRequest, clientConfig)

  let parseResult
  try {
    parseResult = await migrationParser(migrationFunction)
  } catch (error) {
    if (error instanceof SpaceAccessError) {
      console.error(chalk.red.bold(`${error.message}\n`))
    } else {
      console.error(error)
    }
    throw new MigrationError('🚨  Migration unsuccessful', [error])
  }

  if (parseResult.hasStepsValidationErrors()) {
    renderStepsErrors(parseResult.stepsValidationErrors)
    throw new MigrationError('Step validation errors', parseResult.stepsValidationErrors)
  }
  if (parseResult.hasPayloadValidationErrors()) {
    renderStepsErrors(parseResult.payloadValidationErrors)
    throw new MigrationError('Payload validation errors', parseResult.payloadValidationErrors)
  }

  const errorsFile = path.join(process.cwd(), `errors-${Date.now()}.log`)
  const { batches } = parseResult
  if (parseResult.hasValidationErrors()) {
    renderValidationErrors(batches, environmentId)
    throw new MigrationError('Validation errors')
  }
  if (parseResult.hasRuntimeErrors()) {
    renderRuntimeErrors(batches, errorsFile)
    await writeErrorsToLog(parseResult.getRuntimeErrors(), errorsFile)
    throw new MigrationError('Runtime errors', parseResult.getRuntimeErrors())
  }

  await renderPlan(batches, environmentId)

  if (dryRun) {
    console.log(chalk.bold.yellow('⚠️  Dry run completed'))
    return
  }

  const serverErrorsWritten: Promise<void>[] = []
  const tasks = new Listr(batches.map(batch => ({
    title: batch.intent.toPlanMessage().heading,
    task: (_ctx: unknown, parent: { newListr: (tasks: unknown[]) => unknown }) => parent.newListr([{
      title: 'Making requests',
      task: async (_innerCtx: unknown, task: { title: string, output: string }) => {
        const numRequests = batch.requests.length
        const requestErrors: Error[] = []
        let requestsDone = 0
        for (const request of batch.requests) {
          requestsDone += 1
          task.title = `Making requests (${requestsDone}/${numRequests})`
          task.output = `${request.method} ${request.url} at V${request.headers['X-Contentful-Version']}`
          try {
            await makeRequest(request)
          } catch (error) {
            serverErrorsWritten.push(writeErrorsToLog(error, errorsFile))
            requestErrors.push(parseRequestError(error))
          }
        }
        if (requestErrors.length) {
          throw new BatchError('Batch failed', batch, requestErrors)
        }
      }
    }])
  })) as any, { exitOnError: true })

  try {
    await tasks.run()
    console.log(chalk.bold.green('🎉  Migration successful'))
  } catch (error) {
    console.log(chalk.bold.red('🚨  Migration unsuccessful: '))
    console.log(chalk.red(`${errorMessage(error)}\n`))
    // Listr rethrows the error thrown inside the task (e.g. BatchError with
    // `exitOnError`), which carries the collected request errors in `errors`.
    const nestedErrors = Array.isArray((error as { errors?: unknown[] })?.errors)
      ? (error as { errors: unknown[] }).errors
      : []
    nestedErrors.forEach(nestedError => console.log(chalk.red(`${String(nestedError)}\n\n`)))
    await Promise.all(serverErrorsWritten)
    // Only mention the errors log if request errors were actually written to it.
    if (serverErrorsWritten.length > 0) {
      console.log(`Please check the errors log for more details: ${errorsFile}`)
    }
    throw error
  }
}

export default runMigration
