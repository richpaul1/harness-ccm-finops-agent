/**
 * Theme discovery for the report renderer.
 *
 * Each theme lives in `<root>/<id>/` and ships a `manifest.json`, `template.js`,
 * `theme.css`, `web.css`, `print.css`, and `app.js`. Themes are discovered at
 * runtime by reading the configured theme roots.
 *
 * Roots, in priority order (first match wins on duplicate `id`):
 *   1. `process.env.HARNESS_REPORT_THEMES_DIR_EXTRA` — colon-separated list of
 *      absolute directories. Lets customers / CSMs ship branded themes (and
 *      report packs that include themes) without merging into this repo.
 *   2. `report-packs/<pack>/theme/` for any registered pack — picked up via
 *      `getPackThemeRoots()` so a pack's own theme is automatically available.
 *   3. The bundled `src/report-renderer/static/themes/` directory — always last
 *      so a customer override with the same `id` can shadow a built-in theme.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getPackThemeRoots } from "./packs/index.js";

export interface ThemeManifest {
  id: string;
  name: string;
  description: string;
  brand: { wordmark: string; sub: string };
  fonts: string;
  pageSize?: string;
}

export interface Theme extends ThemeManifest {
  /** Absolute path to the theme directory on disk (server-side only). */
  dir: string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const THEMES_DIR = path.resolve(HERE, "static", "themes");
export const PUBLIC_DIR = path.resolve(HERE, "static", "public");

/** Resolve the bundled `pagedjs` polyfill path from this package's deps. */
export function getPagedjsScript(): string {
  // Walk up from build/report-renderer/ → project root, then into node_modules.
  // Build output mirrors src/, so HERE = .../build/report-renderer at runtime.
  const projectRoot = path.resolve(HERE, "..", "..");
  return path.join(projectRoot, "node_modules", "pagedjs", "dist", "paged.polyfill.js");
}

/**
 * The full ordered list of theme roots to scan, deduplicated. First-match-wins
 * for theme `id` collisions, so callers can override a built-in theme by
 * dropping a directory of the same name into an extra root.
 */
export function getThemeRoots(): string[] {
  const roots: string[] = [];
  const extra = process.env.HARNESS_REPORT_THEMES_DIR_EXTRA;
  if (extra) {
    for (const entry of extra.split(":")) {
      const trimmed = entry.trim();
      if (trimmed) roots.push(path.resolve(trimmed));
    }
  }
  for (const root of getPackThemeRoots()) {
    roots.push(path.resolve(root));
  }
  roots.push(THEMES_DIR);
  return Array.from(new Set(roots));
}

function readThemesFrom(rootDir: string): Theme[] {
  if (!fs.existsSync(rootDir)) return [];
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d): Theme | null => {
      const themeDir = path.join(rootDir, d.name);
      const manifestPath = path.join(themeDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) return null;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ThemeManifest;
        return { ...manifest, dir: themeDir };
      } catch {
        return null;
      }
    })
    .filter((t): t is Theme => t !== null);
}

export function listThemes(): Theme[] {
  const seen = new Set<string>();
  const out: Theme[] = [];
  for (const root of getThemeRoots()) {
    for (const t of readThemesFrom(root)) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

export function resolveTheme(id: string | undefined): Theme {
  const themes = listThemes();
  if (themes.length === 0) {
    throw new Error(`No themes found in roots: ${getThemeRoots().join(", ")}`);
  }
  if (id) {
    const match = themes.find((t) => t.id === id);
    if (match) return match;
  }
  return themes.find((t) => t.id === "harness") ?? themes[0]!;
}
