import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { desktopLaunchArg } from "@rolaca11/mcp-inspector-core/desktop";

export interface DesktopOptions {
  config?: string[];
  quiet?: boolean;
}

export async function launchDesktop(options: DesktopOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const appDir = path.join(cwd, "packages/electron");
  let executable: string;
  try {
    await access(path.join(appDir, "dist/main.js"));
    const require = createRequire(path.join(appDir, "package.json"));
    executable = require("electron") as string;
  } catch {
    throw new Error(
      `Desktop app unavailable in ${cwd}. Run \`bun install\` and ` +
        "`bun run build:electron` from the repository root before launching desktop.",
    );
  }

  const launchArg = desktopLaunchArg({
    cwd,
    extraFiles: (options.config ?? []).map((file) => path.resolve(cwd, file)),
    quiet: !!options.quiet,
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [appDir, launchArg], {
      cwd,
      env,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", (error) => {
      reject(new Error(`Could not launch MCP Inspector desktop app: ${error.message}`));
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
  if (!options.quiet) console.error("Opened MCP Inspector desktop app.");
}
