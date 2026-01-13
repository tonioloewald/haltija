#!/usr/bin/env bun
/**
 * Main build script for Haltija
 * Compiles TypeScript, bundles for browser/bun targets, syncs to desktop app
 */

import { $ } from 'bun'

// 1. Embed static assets into TypeScript
await $`bun run scripts/embed-assets.ts`

// 2. Build browser component (IIFE for injection)
await $`bun build ./src/component.ts --outdir=dist --target=browser --format=iife`

// 3. Build server, client, and index for Bun runtime
await $`bun build ./src/server.ts ./src/client.ts ./src/index.ts --outdir=dist --target=bun`

// 4. Sync component to desktop app resources (single source of truth)
await $`cp dist/component.js apps/desktop/resources/component.js`.quiet().nothrow()

console.log('Build complete')
