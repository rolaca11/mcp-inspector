import path from "node:path";
import { z } from "zod";

export const DESKTOP_SCHEME = "mcp-inspector";

const desktopLaunchSchema = z.object({
  cwd: z.string().refine(path.isAbsolute),
  extraFiles: z.array(z.string().refine(path.isAbsolute)),
  quiet: z.boolean(),
});

export type DesktopLaunchOptions = z.infer<typeof desktopLaunchSchema>;

export function desktopLaunchUrl(options: DesktopLaunchOptions): string {
  const url = new URL(`${DESKTOP_SCHEME}://launch`);
  url.searchParams.set("config", JSON.stringify(desktopLaunchSchema.parse(options)));
  return url.toString();
}

export function readDesktopLaunchOptions(
  args: string[],
): DesktopLaunchOptions | undefined {
  const arg = args.find((value) => value.startsWith(`${DESKTOP_SCHEME}://`));
  if (!arg) return undefined;
  const url = new URL(arg);
  if (url.hostname !== "launch" || (url.pathname && url.pathname !== "/")) {
    throw new Error("Invalid desktop launch URL");
  }
  const config = url.searchParams.get("config");
  if (!config) throw new Error("Missing desktop launch configuration");
  return desktopLaunchSchema.parse(JSON.parse(config));
}
