// Type declarations for untyped modules and private contentful-migration internals.
// The private `contentful-migration/built/*` paths are not part of its public API:
// re-check them whenever contentful-migration is upgraded.

declare module 'migrate/lib/log' {
  interface Log {
    (key: string, msg?: unknown): void
    error (key: string, msg?: unknown): void
  }
  const log: Log
  export = log
}

declare module 'migrate/lib/migrate' {
  function runMigrations (
    set: unknown,
    direction: 'up' | 'down',
    migrationName: string | null | undefined,
    fn: (err?: Error | null) => void
  ): void
  export = runMigrations
}

declare module 'migrate/lib/template-generator' {
  interface TemplateOptions {
    name: string
    templateFile: string
    migrationsDirectory: string
    dateFormat?: string
    extension: string
  }
  function templateGenerator (
    opts: TemplateOptions,
    cb: (err: Error | null, filename?: string) => void
  ): void
  export = templateGenerator
}

declare module 'contentful-migration/built/bin/lib/contentful-client' {
  export function createManagementClient (params: Record<string, unknown>): unknown
}

declare module 'contentful-migration/built/lib/errors' {
  export class SpaceAccessError extends Error {}
}

declare module 'contentful-migration/built/bin/cli' {
  export interface MigrationRequest {
    method: string
    url: string
    headers: Record<string, string | number>
    [key: string]: unknown
  }
  export type MakeRequest = (request: MigrationRequest) => Promise<unknown>
  export function createMakeRequest (
    client: unknown,
    options: { spaceId: string, environmentId: string, organizationId?: string, limit?: number, host?: string }
  ): MakeRequest
}

declare module 'contentful-migration/built/lib/migration-parser' {
  import type { MakeRequest, MigrationRequest } from 'contentful-migration/built/bin/cli'

  export interface Batch {
    intent: { toPlanMessage (): { heading: string } }
    requests: MigrationRequest[]
  }

  export interface ParseResult {
    batches: Batch[]
    stepsValidationErrors: unknown[]
    payloadValidationErrors: unknown[]
    hasStepsValidationErrors (): boolean
    hasPayloadValidationErrors (): boolean
    hasValidationErrors (): boolean
    hasRuntimeErrors (): boolean
    getRuntimeErrors (): unknown[]
  }

  function createMigrationParser (
    makeRequest: MakeRequest,
    config: Record<string, unknown>
  ): (migrationFunction: (...args: any[]) => unknown) => Promise<ParseResult>
  export default createMigrationParser
}

declare module 'contentful-migration/built/bin/lib/render-migration' {
  import type { Batch } from 'contentful-migration/built/lib/migration-parser'
  export function renderPlan (batches: Batch[], environmentId: string, quiet?: boolean): Promise<void>
  export function renderValidationErrors (batches: Batch[], environmentId: string): void
  export function renderRuntimeErrors (batches: Batch[], errorsFile: string): void
}

declare module 'contentful-migration/built/bin/lib/steps-errors' {
  export default function renderStepsErrors (errors: unknown[]): void
}

declare module 'contentful-migration/built/bin/lib/write-errors-to-log' {
  export default function writeErrorsToLog (errors: unknown, filename: string): Promise<void>
}
