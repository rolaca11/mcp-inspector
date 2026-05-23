import os from "node:os";
import path from "node:path";

/**
 * Returns the on-disk directory used to persist OAuth tokens, registered
 * client information, and code verifiers between CLI runs.
 *
 * Honors `$XDG_CONFIG_HOME` if set, otherwise `~/.config/mcp-inspector`.
 */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim()) {
    return path.join(xdg, "mcp-inspector");
  }
  return path.join(os.homedir(), ".config", "mcp-inspector");
}

export function authFile(targetId: string): string {
  return path.join(configDir(), "auth", `${targetId}.json`);
}
