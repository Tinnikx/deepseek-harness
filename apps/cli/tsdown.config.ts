import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships two entries: the `bin` referenced by package.json `bin`,
 * and `profile-boot`, the shared profile launcher another app in this
 * installation (`apps/desktop`) imports so both surfaces compose a profile
 * through the same code and the same installation anchor. The root tsdown
 * builds only `lib/types/index.js`, so this override names them instead;
 * their reachable modules bundle with them. Declarations come from `tsc -b`
 * (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/profile-boot.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
