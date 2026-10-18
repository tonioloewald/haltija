import { describe, expect, it } from 'bun:test'
// @ts-ignore — a shipped .mjs with no declarations
import { normalizeLauncherArgs } from '../bin/launcher-args.mjs'

describe('launcher flags (1.13.0 review)', () => {
  it('splits --flag=value for value flags, so --token=x sets a token', () => {
    expect(normalizeLauncherArgs(['--token=s3cr=t', '--port=9000', '--server']).args)
      .toEqual(['--token', 's3cr=t', '--port', '9000', '--server'])
  })

  it('reports a misspelled flag instead of dropping it silently', () => {
    const { args, unknown } = normalizeLauncherArgs(['--tokn', 'x', '--headless'])
    expect(unknown).toEqual(['--tokn'])
    expect(args).toEqual(['--tokn', 'x', '--headless'])
  })

  it('leaves values and known flags alone', () => {
    expect(normalizeLauncherArgs(['--name', 'web', '-f', '3000']).unknown).toEqual([])
  })
})
