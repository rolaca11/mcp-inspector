import path from "node:path";
import { z } from "zod";

const launchPrefix = "--mcp-inspector-launch=";

const desktopLaunchSchema = z.object({
  cwd: z.string().refine(path.isAbsolute),
  extraFiles: z.array(z.string().refine(path.isAbsolute)),
  quiet: z.boolean(),
});

export type DesktopLaunchOptions = z.infer<typeof desktopLaunchSchema>;

export function desktopLaunchArg(options: DesktopLaunchOptions): string {
  return launchPrefix + JSON.stringify(desktopLaunchSchema.parse(options));
}

export function readDesktopLaunchOptions(
  args: string[],
): DesktopLaunchOptions | undefined {
  const arg = args.find((value) => value.startsWith(launchPrefix));
  if (!arg) return undefined;
  return desktopLaunchSchema.parse(JSON.parse(arg.slice(launchPrefix.length)));
}
