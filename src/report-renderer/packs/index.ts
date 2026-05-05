/**
 * Report Pack registry.
 *
 * A Report Pack bundles everything one customer needs to produce a branded
 * report family without touching the core renderer:
 *
 *   report-packs/<id>/
 *     pack.json         — manifest: name, theme_id, block_preprocessors
 *     theme/            — theme directory (manifest.json + template.js + *.css + app.js)
 *     blocks/           — custom ::: block implementations (JS/TS built files)
 *     templates/        — markdown skeletons for each report type
 *     playbook.md       — agent instructions for populating templates
 *
 * Pack roots, in discovery order (first match wins on `id` collision):
 *   1. HARNESS_REPORT_PACKS_DIR_EXTRA — colon-separated list of external dirs
 *   2. <project-root>/report-packs/   — in-repo packs (committed to the repo)
 *
 * Each pack may declare:
 *   - `theme_id`          — the id of the theme inside its `theme/` dir
 *   - `block_preprocessors` — list of JS module paths (relative to the pack
 *       root) that export a `preprocessMarkdown(src: string): string` function.
 *       These are run in sequence, before markdown-it, just like metric-cards.
 *
 * The registry is lazily initialised on first call. Since we're in an
 * always-running MCP server, "lazy" in practice means "at first request",
 * which is fine — the pack dirs are scanned at that point and cached.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("report-packs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Default in-repo packs root: <project-root>/report-packs/ */
const DEFAULT_PACKS_ROOT = path.resolve(HERE, "..", "..", "..", "report-packs");

// ─── Pack manifest ────────────────────────────────────────────────────────────

export interface PackManifest {
  /** Unique identifier for this pack (matches the directory name). */
  id: string;
  /** Human-readable name. */
  name: string;
  /**
   * The theme `id` provided by this pack (inside the `theme/` sub-directory).
   * If omitted the pack has no theme contribution.
   */
  theme_id?: string;
  /**
   * Relative paths (from the pack root) to JS files that export a
   * `preprocessMarkdown(src: string): string` function. Evaluated in order.
   * Example: `["blocks/portfolio-bucket-grid.js", "blocks/portfolio-detail.js"]`
   *
   * Note: paths must point to the *compiled* JS (or `.js` ESM files directly
   * in the pack) because we dynamic-import them at runtime. If you ship TS
   * source, compile it first or author plain `.js` blocks.
   */
  block_preprocessors?: string[];
}

export interface RegisteredPack extends PackManifest {
  /** Absolute path to the pack directory. */
  packDir: string;
  /** Absolute path to the pack's `theme/` directory, or null if absent. */
  themeDir: string | null;
}

// ─── Discovered packs (keyed by id) ─────────────────────────────────────────

const _packs = new Map<string, RegisteredPack>();
let _initialised = false;

function discoverPacksFrom(rootDir: string): void {
  if (!fs.existsSync(rootDir)) return;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const packDir = path.join(rootDir, d.name);
    const manifestPath = path.join(packDir, "pack.json");
    if (!fs.existsSync(manifestPath)) continue;
    let manifest: PackManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as PackManifest;
    } catch (err) {
      log.warn(`Skipping pack at ${packDir}: invalid pack.json (${String(err)})`);
      continue;
    }
    if (_packs.has(manifest.id)) {
      log.debug(`Pack '${manifest.id}' already registered — skipping ${packDir}`);
      continue;
    }
    const themeSubDir = path.join(packDir, "theme");
    const themeManifestPath = path.join(themeSubDir, "manifest.json");
    const themeDir = fs.existsSync(themeManifestPath) ? themeSubDir : null;
    const pack: RegisteredPack = { ...manifest, packDir, themeDir };
    _packs.set(manifest.id, pack);
    log.info(`Registered pack '${manifest.id}' from ${packDir}`, {
      theme: themeDir ?? "none",
      preprocessors: manifest.block_preprocessors?.length ?? 0,
    });
  }
}

function ensureInitialised(): void {
  if (_initialised) return;
  _initialised = true;

  // Extra pack roots (external / CI-injected)
  const extra = process.env.HARNESS_REPORT_PACKS_DIR_EXTRA;
  if (extra) {
    for (const entry of extra.split(":")) {
      const trimmed = entry.trim();
      if (trimmed) discoverPacksFrom(path.resolve(trimmed));
    }
  }
  // In-repo packs (committed)
  discoverPacksFrom(DEFAULT_PACKS_ROOT);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Return all discovered packs. */
export function listPacks(): RegisteredPack[] {
  ensureInitialised();
  return Array.from(_packs.values());
}

/** Return the pack for a given `id`, or undefined. */
export function getPack(id: string): RegisteredPack | undefined {
  ensureInitialised();
  return _packs.get(id);
}

/**
 * Return the `theme/` directory paths from all registered packs that
 * include a theme. Used by `themes.ts` to augment the theme-roots list.
 */
export function getPackThemeRoots(): string[] {
  ensureInitialised();
  // Each pack that has a theme dir contributes the *parent* directory (so
  // themes.ts can do `readdirSync(root)` and find the sub-directory named
  // by `theme_id`). We expose the pack root itself — the `theme/` sub-dir
  // lives inside it and matches exactly the pattern `<root>/<id>/`.
  // To fit the `listThemes()` root scanning model (which does
  //   readdirSync(root) → each sub-dir → manifest.json)
  // we expose the pack root (not the `theme/` dir itself), so the scanner
  // sees `<packRoot>/<theme_id>/manifest.json` inside `<packRoot>/theme/`.
  //
  // Simpler: expose the *parent* of each pack's `theme/` dir, i.e. the
  // packDir itself — but that would cause the scanner to look for
  // `<packDir>/theme/manifest.json` only if `theme` is treated as the ID.
  // The cleanest fit is: expose a synthetic root where the only sub-dir IS
  // the theme directory, named by `theme_id`.
  //
  // We solve this by returning the themeDir's parent so that the scanner
  // finds `<parent>/<theme_id>/` where <parent>/<theme_id> === themeDir.
  const roots: string[] = [];
  for (const pack of _packs.values()) {
    if (pack.themeDir) {
      roots.push(path.dirname(pack.themeDir));
    }
  }
  return roots;
}

/**
 * Collect all preprocessMarkdown functions from all registered packs, in
 * registration order. Returns a list of `(src: string) => string` functions
 * ready to be applied sequentially before markdown-it parses the document.
 *
 * Each module is imported with a per-file mtime cache-buster: if the file on
 * disk has changed since last load, Node's ESM loader sees a fresh specifier
 * and re-evaluates the module. This means editing a pack block `.js` file
 * during development takes effect on the next render without a server restart.
 */
type Preprocessor = (src: string) => string;

/** Per-file: last mtime we loaded at + the preprocessor function. */
interface CacheEntry {
  mtime: number;
  fn: Preprocessor;
}
const _preprocessorCache = new Map<string, CacheEntry>();

export async function loadPackPreprocessors(): Promise<Preprocessor[]> {
  ensureInitialised();
  const fns: Preprocessor[] = [];
  for (const pack of _packs.values()) {
    for (const rel of pack.block_preprocessors ?? []) {
      const abs = path.resolve(pack.packDir, rel);
      let mtime = 0;
      try {
        mtime = fs.statSync(abs).mtimeMs;
      } catch {
        log.warn(`Pack '${pack.id}' preprocessor ${rel} not found on disk`);
        continue;
      }
      const cached = _preprocessorCache.get(abs);
      if (cached && cached.mtime === mtime) {
        fns.push(cached.fn);
        continue;
      }
      try {
        // Append mtime as a query param so Node re-imports when the file changes.
        const mod = (await import(`file://${abs}?t=${mtime}`)) as {
          preprocessMarkdown?: Preprocessor;
          default?: Preprocessor;
        };
        const fn = mod.preprocessMarkdown ?? mod.default;
        if (typeof fn !== "function") {
          log.warn(`Pack '${pack.id}' preprocessor ${rel}: module has no preprocessMarkdown export`);
          continue;
        }
        _preprocessorCache.set(abs, { mtime, fn });
        fns.push(fn);
        log.info(`Loaded preprocessor from pack '${pack.id}': ${rel} (mtime ${mtime})`);
      } catch (err) {
        log.warn(`Pack '${pack.id}' preprocessor ${rel} failed to load: ${String(err)}`);
      }
    }
  }
  return fns;
}
