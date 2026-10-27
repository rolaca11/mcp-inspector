import "./system-certificates.js";

delete process.env.ELECTRON_RUN_AS_NODE;

await import("../../cli/src/cli.js");
