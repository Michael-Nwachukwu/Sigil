import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
    splitting: false,
  },
  {
    entry: { 'sigil-agent': 'bin/sigil-agent.ts' },
    format: ['cjs'],
    sourcemap: true,
    target: 'node20',
    splitting: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
