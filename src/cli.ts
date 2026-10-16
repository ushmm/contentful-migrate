#!/usr/bin/env node

import path from 'node:path'
import yargs from 'yargs'

// Handler failures must produce a non-zero exit code for CI/Automation.
process.on('unhandledRejection', (error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message)
    if (error.stack) console.error(error.stack)
  } else {
    console.error(error)
  }
  process.exitCode = 1
})

yargs(process.argv.slice(2))
  .usage('Manage your Contentful schema by creating incremental scripted changes\nFor more information visit https://github.com/ushmm/contentful-migrate')
  .commandDir(path.join(__dirname, 'commands'))
  .recommendCommands()
  .demandCommand(1, 'Please provide a valid command from the list above')
  .parseAsync()
  .catch((error: Error) => {
    console.error(error.message)
    process.exitCode = 1
  })
