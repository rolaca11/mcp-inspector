/**
 * Reporters render a `RunReport` to a string. `console` is the human-readable
 * default; `json`, `junit` (JUnit XML), and `tap` (TAP version 13) are for CI.
 * The CLI writes the returned string to stdout or `--out`.
 */

import pc from "picocolors";

import type { CaseReport, CaseStartInfo, RunReport, StepReport } from "./runner.js";

export const REPORTERS = ["console", "json", "junit", "tap", "teamcity"] as const;
export type ReporterName = (typeof REPORTERS)[number];

export interface ReporterOptions {
  /** Emit ANSI color (console reporter only). */
  color?: boolean;
}

export function renderReport(
  name: ReporterName,
  report: RunReport,
  opts: ReporterOptions = {},
): string {
  switch (name) {
    case "console":
      return consoleReporter(report, opts);
    case "json":
      return jsonReporter(report);
    case "junit":
      return junitReporter(report);
    case "tap":
      return tapReporter(report);
    case "teamcity":
      return teamcityReporter(report);
  }
}

/* ------------------------------------------------------------------ */
/* console                                                             */
/* ------------------------------------------------------------------ */

type Paint = (s: string) => string;
const identity: Paint = (s) => s;

interface Palette {
  bold: Paint;
  dim: Paint;
  green: Paint;
  red: Paint;
  yellow: Paint;
}

function consoleReporter(report: RunReport, opts: ReporterOptions): string {
  const c: Palette = opts.color
    ? { bold: pc.bold, dim: pc.dim, green: pc.green, red: pc.red, yellow: pc.yellow }
    : { bold: identity, dim: identity, green: identity, red: identity, yellow: identity };

  const lines: string[] = [];
  for (const [source, cases] of groupBySource(report.cases)) {
    lines.push(c.bold(source));
    for (const cr of cases) {
      const mark = cr.ok ? c.green("✓") : c.red("✗");
      lines.push(`  ${mark} ${cr.name} ${c.dim(`(${cr.durationMs}ms)`)}`);
      if (!cr.ok) lines.push(...failureDetail(cr, c));
    }
    lines.push("");
  }

  const summary = `${report.passed} passed, ${report.failed} failed (${report.cases.length} ${report.cases.length === 1 ? "case" : "cases"}, ${report.durationMs}ms)`;
  lines.push(report.ok ? c.green(summary) : c.red(summary));
  return lines.join("\n");
}

function failureDetail(cr: CaseReport, c: Palette): string[] {
  const out: string[] = [];
  if (cr.error) out.push(`      ${c.red(cr.error)}`);
  for (const sr of cr.steps) {
    if (sr.ok) continue;
    if (sr.error) out.push(`      ${c.yellow(sr.action)}: ${c.red(sr.error)}`);
    for (const a of sr.assertions) {
      if (a.ok) continue;
      out.push(`      ${c.yellow(sr.action)} ${c.dim(a.path)}: ${a.message}`);
    }
  }
  return out;
}

function groupBySource(cases: CaseReport[]): Array<[string, CaseReport[]]> {
  const map = new Map<string, CaseReport[]>();
  for (const c of cases) {
    const list = map.get(c.source);
    if (list) list.push(c);
    else map.set(c.source, [c]);
  }
  return Array.from(map.entries());
}

/* ------------------------------------------------------------------ */
/* json                                                                */
/* ------------------------------------------------------------------ */

function jsonReporter(report: RunReport): string {
  return JSON.stringify(report, null, 2);
}

/* ------------------------------------------------------------------ */
/* junit                                                               */
/* ------------------------------------------------------------------ */

function junitReporter(report: RunReport): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${report.cases.length}" failures="${report.failed}" time="${sec(report.durationMs)}">`,
  ];
  for (const [source, cases] of groupBySource(report.cases)) {
    const failures = cases.filter((c) => !c.ok).length;
    const time = sec(cases.reduce((s, c) => s + c.durationMs, 0));
    lines.push(
      `  <testsuite name="${attr(source)}" tests="${cases.length}" failures="${failures}" time="${time}">`,
    );
    for (const cr of cases) {
      const open = `    <testcase name="${attr(cr.name)}" classname="${attr(source)}" time="${sec(cr.durationMs)}"`;
      if (cr.ok) {
        lines.push(`${open}/>`);
      } else {
        lines.push(`${open}>`);
        lines.push(
          `      <failure message="${attr(firstFailureMessage(cr))}">${text(failureText(cr))}</failure>`,
        );
        lines.push("    </testcase>");
      }
    }
    lines.push("  </testsuite>");
  }
  lines.push("</testsuites>");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* tap                                                                 */
/* ------------------------------------------------------------------ */

function tapReporter(report: RunReport): string {
  const lines: string[] = ["TAP version 13", `1..${report.cases.length}`];
  report.cases.forEach((cr, i) => {
    const status = cr.ok ? "ok" : "not ok";
    lines.push(`${status} ${i + 1} - ${cr.name}`);
    if (!cr.ok) {
      lines.push("  ---");
      lines.push("  message: |");
      for (const line of failureText(cr).split("\n")) lines.push(`    ${line}`);
      lines.push("  ---");
    }
  });
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* teamcity (JetBrains / TeamCity service messages)                    */
/* ------------------------------------------------------------------ */

/**
 * A live emitter of TeamCity service messages — the protocol JetBrains IDEs and
 * TeamCity parse off stdout to build their test tree. Wire `onCaseStart` /
 * `onCaseComplete` to the runner's hooks (so the tree fills in as each case
 * resolves), then call `end()` to close the final suite. `write` receives one
 * message line at a time (no trailing newline).
 */
export interface TeamCityStream {
  onCaseStart(info: CaseStartInfo): void;
  onCaseComplete(report: CaseReport): void;
  end(): void;
}

export function createTeamCityStream(write: (line: string) => void): TeamCityStream {
  // Cases run grouped by source file, so a source change marks a suite boundary.
  let openSuite: string | null = null;

  const openIfNeeded = (source: string) => {
    if (openSuite === source) return;
    if (openSuite !== null) write(tcMessage("testSuiteFinished", { name: openSuite }));
    write(tcMessage("testSuiteStarted", { name: source }));
    openSuite = source;
  };

  return {
    onCaseStart({ name, source }) {
      openIfNeeded(source);
      write(tcMessage("testStarted", { name, captureStandardOutput: "true" }));
    },
    onCaseComplete(cr) {
      // A case may complete without a matching start (batch rendering).
      openIfNeeded(cr.source);
      if (!cr.ok) {
        write(
          tcMessage("testFailed", {
            name: cr.name,
            message: firstFailureMessage(cr),
            details: failureText(cr),
          }),
        );
      }
      write(tcMessage("testFinished", { name: cr.name, duration: String(cr.durationMs) }));
    },
    end() {
      if (openSuite !== null) {
        write(tcMessage("testSuiteFinished", { name: openSuite }));
        openSuite = null;
      }
    },
  };
}

/** Batch form: replays the stream over a finished report into a single string. */
function teamcityReporter(report: RunReport): string {
  const lines: string[] = [];
  const stream = createTeamCityStream((line) => lines.push(line));
  for (const cr of report.cases) {
    stream.onCaseStart({ name: cr.name, source: cr.source });
    stream.onCaseComplete(cr);
  }
  stream.end();
  return lines.join("\n");
}

function tcMessage(type: string, attrs: Record<string, string>): string {
  const body = Object.entries(attrs)
    .map(([k, v]) => `${k}='${tcEscape(v)}'`)
    .join(" ");
  return `##teamcity[${type} ${body}]`;
}

/** Escape per the TeamCity service-message spec (pipe is the escape char). */
function tcEscape(s: string): string {
  return s
    .replace(/\|/g, "||")
    .replace(/'/g, "|'")
    .replace(/\n/g, "|n")
    .replace(/\r/g, "|r")
    .replace(/\[/g, "|[")
    .replace(/\]/g, "|]");
}

/* ------------------------------------------------------------------ */
/* shared failure rendering                                            */
/* ------------------------------------------------------------------ */

function stepFailureLines(sr: StepReport): string[] {
  const out: string[] = [];
  if (sr.error) out.push(`${sr.action}: ${sr.error}`);
  for (const a of sr.assertions) {
    if (!a.ok) out.push(`${sr.action} ${a.path}: ${a.message}`);
  }
  return out;
}

function failureText(cr: CaseReport): string {
  const out: string[] = [];
  if (cr.error) out.push(cr.error);
  for (const sr of cr.steps) {
    if (!sr.ok) out.push(...stepFailureLines(sr));
  }
  return out.join("\n") || "failed";
}

function firstFailureMessage(cr: CaseReport): string {
  if (cr.error) return cr.error;
  for (const sr of cr.steps) {
    const [first] = stepFailureLines(sr);
    if (first) return first;
  }
  return "failed";
}

function sec(ms: number): string {
  return (ms / 1000).toFixed(3);
}

function attr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function text(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
