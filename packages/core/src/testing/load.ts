/**
 * Discovery + parsing of suite files. Accepts file or directory paths;
 * directories are walked recursively for `.yaml`/`.yml`/`.json` files. Each
 * file is parsed (YAML or JSON by extension) and validated into a `Suite`.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { parseSuite, type LoadedSuite } from "./schema.js";

const EXTENSIONS = new Set([".yaml", ".yml", ".json"]);

/**
 * Expand the given paths into a sorted, de-duplicated list of suite files.
 * Files are taken as-is; directories are scanned recursively. Throws if a
 * given path doesn't exist.
 */
export async function discoverFiles(paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const p of paths) {
    const stat = await fs.stat(p).catch(() => null);
    if (!stat) throw new Error(`path not found: ${p}`);
    if (stat.isFile()) {
      found.push(p);
      continue;
    }
    if (!stat.isDirectory()) continue;
    const entries = await fs.readdir(p, { recursive: true });
    for (const entry of entries) {
      const full = path.join(p, entry.toString());
      if (!EXTENSIONS.has(path.extname(full).toLowerCase())) continue;
      const st = await fs.stat(full).catch(() => null);
      if (st?.isFile()) found.push(full);
    }
  }
  return Array.from(new Set(found)).sort();
}

/** Discover, read, parse, and validate every suite under the given paths. */
export async function loadSuites(paths: string[]): Promise<LoadedSuite[]> {
  const files = await discoverFiles(paths);
  const suites: LoadedSuite[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    let data: unknown;
    try {
      data = file.toLowerCase().endsWith(".json") ? JSON.parse(text) : parseYaml(text);
    } catch (e) {
      throw new Error(`Failed to parse ${file}: ${(e as Error).message}`);
    }
    suites.push({ source: file, suite: parseSuite(data, file) });
  }
  return suites;
}
