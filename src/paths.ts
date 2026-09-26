import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directory of this module, canonicalized so symlinked checkouts, tmpdir
 * aliasing (`/var` vs `/private/var`), and Windows 8.3 short names cannot
 * split the reported locations from the caller's spelling. */
const moduleDir = (): string => {
  try {
    return realpathSync(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    return path.dirname(fileURLToPath(import.meta.url));
  }
};

/**
 * Resolve the provider package root from any layout, workit-style: source
 * modules live in `src/`, the plugin entry at the package root (`plugin.ts`),
 * and a future bundle in `dist/`. The nearest ancestor with a `package.json`
 * wins, so moving a source file or bundling the entry can never silently
 * point catalog reads at the wrong directory.
 */
export const packageRoot = (): string => {
  const dir = moduleDir();
  for (const candidate of [
    path.resolve(dir, ".."),
    path.resolve(dir, "..", ".."),
    path.resolve(dir, "..", "..", ".."),
  ]) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return path.resolve(dir, "..");
};

/** Catalog artifact locations under the resolved package root. */
export const catalogPaths = (): { models: string; manifest: string; version: string } => {
  const root = packageRoot();
  return {
    models: path.join(root, "models.json"),
    manifest: path.join(root, "manifest.json"),
    version: path.join(root, "_version.txt"),
  };
};
