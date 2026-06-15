/**
 * Public entry point for the declarative testing framework. The CLI imports
 * from here (`@rolaca11/mcp-inspector-core/testing`).
 */

export { loadSuites, discoverFiles } from "./load.js";
export {
  parseSuite,
  LIST_KINDS,
  type Suite,
  type Case,
  type Step,
  type CompleteArgs,
  type ListKind,
  type LoadedSuite,
} from "./schema.js";
export {
  runSuites,
  type RunReport,
  type RunOptions,
  type CaseReport,
  type CaseStartInfo,
  type StepReport,
} from "./runner.js";
export {
  renderReport,
  createTeamCityStream,
  REPORTERS,
  type ReporterName,
  type ReporterOptions,
  type TeamCityStream,
} from "./report.js";
export {
  evaluateExpect,
  deepEqual,
  type AssertionResult,
} from "./matchers.js";
export { interpolate, getPath, resolveRef, type Scope } from "./vars.js";
