import { setTimeout } from "node:timers/promises";

export async function publishedVersions(ppa, { get = fetch, wait = setTimeout, warn = console.warn } = {}) {
  const url = new URL(`https://api.launchpad.net/1.0/~${ppa.owner}/+archive/ubuntu/${ppa.name}`);
  url.search = new URLSearchParams({ "ws.op": "getPublishedSources", source_name: "mcp-inspector", exact_match: "true", "ws.size": "100" });
  const versions = new Set();
  let next = url.href;
  while (next) {
    const sources = await listing(next, { get, wait, warn });
    for (const source of sources.entries) versions.add(source.source_package_version);
    next = sources.next_collection_link;
  }
  return versions;
}

async function listing(url, { get, wait, warn }) {
  const attempts = 4;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await get(url, {
        headers: { "Cache-Control": "no-cache", "User-Agent": "mcp-inspector-release" },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Could not list PPA sources: HTTP ${response.status}`);
      const sources = await response.json();
      if (!Array.isArray(sources.entries)) throw new Error("Launchpad returned an invalid source listing");
      return sources;
    } catch (error) {
      if (attempt === attempts) throw error;
      const delay = 10000 * 2 ** (attempt - 1);
      warn(`Listing PPA sources failed on attempt ${attempt}/${attempts}: ${error.message}. Retrying in ${delay / 1000} seconds.`);
      await wait(delay);
    }
  }
}
