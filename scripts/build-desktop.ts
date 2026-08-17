/**
 * Package the Electron desktop shell into an unpacked, VSCode-shaped product
 * directory.
 *
 * The layout and its two launch paths are the deliverable:
 *
 * ```
 * dist/desktop/dsh-linux-x64/
 * ├── dsh                  renamed Electron binary — opens the GUI
 * ├── bin/dsh              CLI wrapper — the same binary under ELECTRON_RUN_AS_NODE
 * ├── resources/app/       the application, plain files (asar disabled)
 * │   ├── package.json     main: lib/main.js
 * │   ├── lib/main.js
 * │   └── node_modules/    pnpm-deployed production closure
 * └── locales/, *.pak, …   Electron runtime
 * ```
 *
 * The closure comes from `pnpm deploy`, which produces an isolated
 * `node_modules/.pnpm` store with relative symlinks into it. Those links are
 * preserved rather than dereferenced (`derefSymlinks: false`): the store lives
 * inside the copied tree, so most links stay valid, and dereferencing would
 * duplicate every package once per dependent — and can never terminate on the
 * cyclic links peer resolution creates.
 *
 * Two link repairs make that preservation correct, and both are mandatory:
 *
 * - A `link:` workspace dependency stays a link into the repository, so the
 *   deployed tree is not self-contained. {@link DesktopBuild.materializeLinks}
 *   copies each escaping target in before packaging.
 * - The packager's copy resolves every relative link to an absolute path
 *   inside the staging directory, which the product does not contain.
 *   {@link DesktopBuild.relativizeLinks} maps them back afterwards.
 *
 * The `electron` package survives `--prod` as an optional peer of the carrier,
 * and is left in place: it is 1 MB of resolution metadata, Electron's own
 * `electron` builtin outranks it in the main process, and removing it would
 * dangle the carrier's link to it.
 */

import { packager } from '@electron/packager'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, readdir, readlink, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '..')

/** The workspace whose dependency closure becomes `resources/app`. */
const APP_PACKAGE = '@deepseek-ai/dsh-desktop'
/** Product directory root; packager appends `<name>-<platform>-<arch>`. */
const OUT_DIR = 'dist/desktop'
/** Cleared and rewritten on every run; holds the `pnpm deploy` output. */
const STAGING_DIR = 'dist/desktop-staging'
/** Executable and product-directory name — `dsh`, not the scoped package name. */
const PRODUCT_NAME = 'dsh'
/** Linux x64 is the only supported target; see the plan's platform decision. */
const PLATFORM = 'linux'
const ARCH = 'x64'

/** The CLI entry inside the packaged closure, reached by `bin/dsh`. */
const CLI_ENTRY = 'resources/app/node_modules/@deepseek-ai/dsh/lib/bin.js'

/**
 * Build outputs the packager cannot produce and will not detect as missing —
 * a staged tree without them packages cleanly and fails at runtime.
 */
const REQUIRED_ARTIFACTS = [
  'apps/desktop/lib/main.js',
  'apps/cli/lib/bin.js',
  'apps/cli/lib/profile-boot.js',
  'apps/web/dist/index.html',
  'packages/client/connection/lib/index.js',
  'packages/client/connection/lib/client.js',
]

/**
 * TypeScript intermediates that `files: ["lib"]` sweeps into the deploy but
 * that no runtime path reads. Matched against app-relative paths with a
 * leading separator, as packager specifies.
 */
const IGNORE_PATTERNS = [
  /^\/lib\/types($|\/)/,
  /^\/lib\/tsconfig\.tsbuildinfo$/,
]

/**
 * `bin/dsh`: run the packaged CLI on the Electron binary's own Node.
 *
 * `ELECTRON_RUN_AS_NODE` stays exported rather than being consumed here,
 * because the harness re-launches `process.execPath` for subprocess and worker
 * capabilities — those children are the same Electron binary and need the same
 * flag to come up as Node.
 */
const CLI_WRAPPER = `#!/bin/sh
# dsh command line, inside the packaged desktop application.
HERE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd) || exit 1
export ELECTRON_RUN_AS_NODE=1
exec "$HERE/${PRODUCT_NAME}" "$HERE/${CLI_ENTRY}" "$@"
`

/** Validated command line; construction owns the help and parse-error exits. */
class DesktopBuildCli {
  private constructor(
    /** Skip `pnpm run build`; every entry of {@link REQUIRED_ARTIFACTS} must already exist. */
    readonly skipBuild: boolean,
    /** Print each command and filesystem change instead of performing it. */
    readonly dryRun: boolean,
  ) {}

  /**
   * Parse argv. `--help` exits 0 and a malformed flag exits 1.
   * @param argv - the raw arguments (`process.argv.slice(2)`).
   * @returns the parsed configuration.
   */
  static parse(argv: string[]): DesktopBuildCli {
    let values: { 'skip-build': boolean; 'dry-run': boolean; help: boolean }
    try {
      values = parseArgs({
        args: argv,
        options: {
          'skip-build': { type: 'boolean', default: false },
          'dry-run': { type: 'boolean', default: false },
          'help': { type: 'boolean', default: false },
        },
      }).values
    } catch (error) {
      console.error(`build-desktop: ${error instanceof Error ? error.message : String(error)}\n`)
      console.error(DesktopBuildCli.usage())
      process.exit(1)
    }
    if (values.help) {
      console.log(DesktopBuildCli.usage())
      process.exit(0)
    }
    return new DesktopBuildCli(values['skip-build'], values['dry-run'])
  }

  private static usage(): string {
    return [
      'Usage: pnpm exec tsx scripts/build-desktop.ts [flags]',
      '',
      '  --skip-build  skip `pnpm run build`; lib/ and apps/web/dist must already exist.',
      '  --dry-run     print every command and filesystem change without performing it.',
      '  --help        print this help.',
      '',
      `Writes ${OUT_DIR}/${PRODUCT_NAME}-${PLATFORM}-${ARCH}/ for ${PLATFORM}-${ARCH} only.`,
    ].join('\n')
  }
}

function pnpmBin(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

/**
 * Render a command for logs and errors, quoting arguments with spaces.
 * @param command - the executable.
 * @param args - its arguments.
 * @returns the printable command line.
 */
function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(part => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')
}

/**
 * Read a JSON manifest's `version`.
 * @param manifestPath - absolute path to a `package.json`.
 * @returns the declared version.
 * @throws when the file is absent or declares no version.
 */
async function readVersion(manifestPath: string): Promise<string> {
  if (!existsSync(manifestPath)) throw new Error(`build-desktop: ${manifestPath} is missing.`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error(`build-desktop: ${manifestPath} declares no version.`)
  return manifest.version
}

/** The sequential packaging pipeline; each step logs the command it runs. */
class DesktopBuild {
  readonly staging = resolve(root, STAGING_DIR)
  readonly outDir = resolve(root, OUT_DIR)
  readonly product = resolve(root, OUT_DIR, `${PRODUCT_NAME}-${PLATFORM}-${ARCH}`)

  constructor(private readonly cli: DesktopBuildCli) {}

  /** Build every workspace artifact unless `--skip-build` was passed. */
  async build(): Promise<void> {
    if (!this.cli.skipBuild) {
      await this.run('build', pnpmBin(), ['run', 'build'])
      return
    }
    console.log('build-desktop: skipping pnpm run build (--skip-build)')
  }

  /**
   * Fail before staging when a runtime artifact the packager cannot produce is
   * absent, so the error names the missing file instead of surfacing as a blank
   * window minutes later.
   * @throws listing every missing artifact.
   */
  verifyArtifacts(): void {
    if (this.cli.dryRun) return
    const missing = REQUIRED_ARTIFACTS.filter(path => !existsSync(resolve(root, path)))
    if (missing.length === 0) return
    throw new Error(
      `build-desktop: build artifacts missing: ${missing.join(', ')}. Run without --skip-build.`,
    )
  }

  /**
   * Clear the staging directory and deploy the production closure into it.
   *
   * `--legacy` is required because the isolated deploy resolver refuses a
   * workspace whose dependencies are `link:` targets, which every vendored
   * Cordis package is.
   * @throws when the staging path escapes the repository's output directory.
   */
  async stage(): Promise<void> {
    const inOutputDir = relative(resolve(root, 'dist'), this.staging)
    if (inOutputDir.startsWith('..') || inOutputDir === '') {
      throw new Error(`build-desktop: refusing to clear ${this.staging}: it is not inside dist/.`)
    }
    if (this.cli.dryRun) console.log(`build-desktop: [dry-run] rm -rf ${this.staging}`)
    else await rm(this.staging, { recursive: true, force: true })
    await this.run('deploy', pnpmBin(), ['--filter', APP_PACKAGE, 'deploy', '--legacy', '--prod', this.staging])
  }

  /**
   * Reinstall the workspace with its development dependencies.
   *
   * A legacy deploy installs through the workspace root and records the
   * `--prod` selection there, so every later `pnpm run` sees a tree it believes
   * is missing its development dependencies and reinstalls without them. The
   * repository must be left as this script found it.
   */
  async restoreWorkspace(): Promise<void> {
    await this.run('restore', pnpmBin(), ['install'])
  }

  /**
   * List every symbolic link below a directory, without following any of them.
   * @param directory - the root to walk.
   * @returns absolute paths of the links found, parents before children.
   */
  private async findLinks(directory: string): Promise<string[]> {
    const found: string[] = []
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) found.push(path)
      else if (entry.isDirectory()) found.push(...await this.findLinks(path))
    }
    return found
  }

  /** Whether a path is the staging directory or lies inside it. */
  private isStaged(path: string): boolean {
    return path === this.staging || path.startsWith(this.staging + sep)
  }

  /**
   * Replace every staged link whose target lies outside the staging directory
   * with a copy of that target.
   *
   * `pnpm deploy` leaves a `link:` workspace dependency pointing at the
   * repository — the vendored Cordis packages and the native-addon platform
   * packages are all declared that way. Nested `node_modules` are excluded so
   * the copy keeps resolving its own dependencies through the store directory
   * that already contains them.
   */
  async materializeLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-desktop: [dry-run] materialize staged links that escape the closure')
      return
    }
    const nodeModules = join(this.staging, 'node_modules')
    const sources = new Set<string>()
    let count = 0
    for (const link of await this.findLinks(nodeModules)) {
      const target = await realpath(link)
      if (this.isStaged(target)) continue
      const nested = join(target, 'node_modules')
      await rm(link, { recursive: true, force: true })
      await cp(target, link, {
        recursive: true,
        dereference: true,
        filter: path => path !== nested && !path.startsWith(nested + sep),
      })
      sources.add(relative(root, target))
      count += 1
    }
    console.log(`build-desktop: materialized ${count} link(s) escaping the closure, from ${[...sources].sort().join(', ') || 'nothing'}`)
  }

  /**
   * Rewrite the product's absolute links back into the product.
   *
   * The packager's copy resolves relative link targets against the source tree,
   * so a packaged closure points at the staging directory it was copied from —
   * correct on this machine until staging is cleared, and never correct
   * anywhere else.
   * @throws when a link points outside the staged closure, which
   * {@link materializeLinks} was supposed to have removed.
   */
  async relativizeLinks(): Promise<void> {
    if (this.cli.dryRun) {
      console.log('build-desktop: [dry-run] rewrite product links to product-relative targets')
      return
    }
    const appDir = join(this.product, 'resources', 'app')
    let rewritten = 0
    for (const link of await this.findLinks(appDir)) {
      const target = await readlink(link)
      if (!isAbsolute(target)) continue
      if (!this.isStaged(target)) {
        throw new Error(`build-desktop: ${link} points outside the staged closure: ${target}`)
      }
      await unlink(link)
      await symlink(relative(dirname(link), join(appDir, relative(this.staging, target))), link)
      rewritten += 1
    }
    console.log(`build-desktop: rewrote ${rewritten} product link(s) to relative targets`)
  }

  /**
   * Run the packager over the staged closure.
   * @returns the product directory path.
   */
  async pack(): Promise<string> {
    const electronVersion = await readVersion(resolve(root, 'node_modules/electron/package.json'))
    const appVersion = await readVersion(resolve(root, 'apps/desktop/package.json'))
    if (this.cli.dryRun) {
      console.log(`build-desktop: [dry-run] package ${this.staging} -> ${this.product} (electron ${electronVersion}, app ${appVersion})`)
      return this.product
    }
    console.log(`build-desktop: packaging with electron ${electronVersion}`)
    const [built] = await packager({
      dir: this.staging,
      out: this.outDir,
      name: PRODUCT_NAME,
      executableName: PRODUCT_NAME,
      appVersion,
      electronVersion,
      platform: PLATFORM,
      arch: ARCH,
      // Plain files, as the delivery decision requires: the product directory
      // stays readable and patchable without an archive tool.
      asar: false,
      // pnpm already produced a production-only closure; packager's pruner runs
      // npm against a store layout npm does not understand.
      prune: false,
      derefSymlinks: false,
      overwrite: true,
      ignore: IGNORE_PATTERNS,
    })
    if (built === undefined) throw new Error('build-desktop: packager produced no output directory.')
    if (resolve(built) !== this.product) {
      throw new Error(`build-desktop: packager wrote ${built}, expected ${this.product}.`)
    }
    return this.product
  }

  /** Write the executable `bin/dsh` CLI wrapper into the product directory. */
  async writeCliWrapper(): Promise<void> {
    const path = join(this.product, 'bin', PRODUCT_NAME)
    if (this.cli.dryRun) {
      console.log(`build-desktop: [dry-run] write ${path} (mode 755)`)
      return
    }
    if (!existsSync(join(this.product, CLI_ENTRY.split('/').join(sep)))) {
      throw new Error(`build-desktop: ${CLI_ENTRY} is absent from the product; the CLI wrapper would not run.`)
    }
    await mkdir(join(this.product, 'bin'), { recursive: true })
    await writeFile(path, CLI_WRAPPER)
    await chmod(path, 0o755)
    console.log(`build-desktop: wrote ${path}`)
  }

  /** Print the product path, its launch commands, and the Electron binary size. */
  report(): void {
    if (this.cli.dryRun) {
      console.log(`build-desktop: [dry-run] would produce ${this.product}`)
      return
    }
    const executable = join(this.product, PRODUCT_NAME)
    const megabytes = statSync(executable).size / (1024 * 1024)
    console.log(`build-desktop: product: ${this.product}`)
    console.log(`  ${executable}  (${megabytes.toFixed(1)} MB)  — GUI`)
    console.log(`  ${join(this.product, 'bin', PRODUCT_NAME)}  — CLI`)
  }

  /**
   * Run one subprocess with inherited stdio.
   * @param label - the step name used in logs and error messages.
   * @param command - the executable.
   * @param args - its arguments.
   * @throws when the process fails to spawn or exits non-zero.
   */
  private async run(label: string, command: string, args: string[]): Promise<void> {
    const printable = formatCommand(command, args)
    if (this.cli.dryRun) {
      console.log(`build-desktop: [dry-run] ${printable}`)
      return
    }
    console.log(`build-desktop: ${label}: ${printable}`)
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        // Artifact builds must not mutate or validate a developer's Git hooks.
        env: { ...process.env, CI: 'true' },
      })
      child.once('error', (error) => {
        reject(new Error(`build-desktop: ${label} failed to spawn: ${error.message} (${printable})`))
      })
      child.once('exit', (code, signal) => {
        if (code === 0) {
          resolvePromise()
          return
        }
        const cause = code === null ? `signal ${signal ?? 'unknown'}` : `exit code ${code}`
        reject(new Error(`build-desktop: ${label} failed (${cause}): ${printable}`))
      })
    })
  }
}

async function main(): Promise<void> {
  const cli = DesktopBuildCli.parse(process.argv.slice(2))
  const pipeline = new DesktopBuild(cli)
  console.log(`build-desktop: target: ${PLATFORM}-${ARCH}`)
  console.log(`build-desktop: staging: ${pipeline.staging}`)
  await pipeline.build()
  pipeline.verifyArtifacts()
  try {
    await pipeline.stage()
    await pipeline.materializeLinks()
    await pipeline.pack()
    await pipeline.relativizeLinks()
    await pipeline.writeCliWrapper()
  } finally {
    // The deploy mutated the workspace root whether or not packaging succeeded.
    await pipeline.restoreWorkspace()
  }
  pipeline.report()
}

await main()
