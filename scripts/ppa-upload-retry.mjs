import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

export async function uploadWithRetry(args, { run = execFileSync, wait = setTimeout, warn = console.warn } = {}) {
  const attempts = 4;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      run("dput", args, { stdio: "inherit" });
      return;
    } catch (error) {
      if (!Number.isInteger(error.status) || attempt === attempts) throw error;
      const delay = 10000 * 2 ** (attempt - 1);
      warn(`Upload of ${args.at(-1)} failed on attempt ${attempt}/${attempts}. Retrying in ${delay / 1000} seconds.`);
      await wait(delay);
    }
  }
}
