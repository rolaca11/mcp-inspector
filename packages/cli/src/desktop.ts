import path from "node:path";
import open from "open";
import { desktopLaunchUrl } from "@rolaca11/mcp-inspector-core/desktop";
import { errorMessage } from "@rolaca11/mcp-inspector-core/format";

export interface DesktopOptions {
  config?: string[];
  quiet?: boolean;
}

export async function launchDesktop(options: DesktopOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const url = desktopLaunchUrl({
    cwd,
    extraFiles: (options.config ?? []).map((file) => path.resolve(cwd, file)),
    quiet: !!options.quiet,
  });
  try {
    await open(url);
  } catch (error) {
    throw new Error(
      `Could not launch MCP Inspector desktop app: ${errorMessage(error)}. ` +
        "Install the desktop app and register its mcp-inspector:// URL handler.",
    );
  }
  if (!options.quiet) console.error("Requested MCP Inspector desktop app launch.");
}
