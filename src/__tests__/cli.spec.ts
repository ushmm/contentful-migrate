import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const cli = path.resolve('dist/cli.js')
const directories: string[] = []
const env = {
  ...process.env,
  CONTENTFUL_MANAGEMENT_ACCESS_TOKEN: '',
  CONTENTFUL_SPACE_ID: '',
  CONTENTFUL_ENV_ID: ''
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('compiled CLI (offline)', () => {
  it('registers all six commands', () => {
    const output = execFileSync(process.execPath, [cli, '--help'], { env, encoding: 'utf8' })
    for (const command of ['init', 'create', 'list', 'up', 'down', 'bootstrap']) {
      expect(output).toContain(command)
    }
  })

  it.each(['init', 'create', 'list', 'up', 'down', 'bootstrap']
    .map(command => [command]))('loads %s help without credentials or network access', (command) => {
    const output = execFileSync(process.execPath, [cli, command, '--help'], { env, encoding: 'utf8' })
    expect(output).toContain('Options:')
  })

  it('creates a usable CommonJS migration from the packaged template', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ctf-migrate-cli-'))
    directories.push(directory)
    execFileSync(process.execPath, [cli, 'create', 'new model', '-c', 'post'], {
      env: { ...env, CONTENTFUL_MIGRATIONS_DIR: directory }
    })
    const files = fs.readdirSync(path.join(directory, 'post'))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\d{14}-new-model\.js$/)
    const source = fs.readFileSync(path.join(directory, 'post', files[0]), 'utf8')
    const migration = { exports: {} as Record<string, unknown> }
    // Evaluate only our own generated local template, never user migration code.
    // eslint-disable-next-line no-new-func
    new Function('module', source)(migration)
    expect(migration.exports.up).toBeTypeOf('function')
    expect(migration.exports.down).toBeTypeOf('function')
  })

  it('rejects contradictory selection options before contacting Contentful', () => {
    const result = spawnSync(process.execPath, [cli, 'up', '-t', 'fake', '-s', 'fake', '-a', '-c', 'post'], {
      env,
      encoding: 'utf8'
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('mutually exclusive')
  })
})
