/**
 * Theme discovery for the report renderer.
 *
 * Each theme lives in `src/report-renderer/static/themes/<id>/` and ships
 * a `manifest.json`, `template.js`, `theme.css`, `web.css`, `print.css`, and
 * `app.js`. Themes are discovered at runtime by reading the `themes/` dir.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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

export function listThemes(): Theme[] {
  if (!fs.existsSync(THEMES_DIR)) return [];
  return fs
    .readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d): Theme | null => {
      const manifestPath = path.join(THEMES_DIR, d.name, "manifest.json");
      if (!fs.existsSync(manifestPath)) return null;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ThemeManifest;
      return { ...manifest, dir: path.join(THEMES_DIR, d.name) };
    })
    .filter((t): t is Theme => t !== null);
}

export function resolveTheme(id: string | undefined): Theme {
  const themes = listThemes();
  if (themes.length === 0) {
    throw new Error(`No themes found at ${THEMES_DIR}`);
  }
  if (id) {
    const match = themes.find((t) => t.id === id);
    if (match) return match;
  }
  return themes.find((t) => t.id === "harness") ?? themes[0]!;
}
