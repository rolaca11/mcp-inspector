import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Session } from "../client.js";
import { connect } from "../client.js";
import {
  createTeamCityStream,
  deepEqual,
  evaluateExpect,
  getPath,
  interpolate,
  loadSuites,
  parseSuite,
  renderReport,
  runSuites,
  type LoadedSuite,
  type RunReport,
} from "../testing/index.js";
import {
  startSessionServer,
  type SessionTestServer,
} from "./helpers/session-server.js";

/* ------------------------------------------------------------------ */
/* Path resolution + interpolation                                     */
/* ------------------------------------------------------------------ */

describe("getPath", () => {
  const obj = {
    content: [{ type: "text", text: "hello" }],
    structuredContent: { temp: 33, nested: { a: [1, 2, 3] } },
  };

  it("resolves nested object + array paths", () => {
    expect(getPath(obj, "content.0.text")).toBe("hello");
    expect(getPath(obj, "structuredContent.temp")).toBe(33);
    expect(getPath(obj, "structuredContent.nested.a.2")).toBe(3);
  });

  it("returns undefined for missing or invalid segments", () => {
    expect(getPath(obj, "content.5.text")).toBeUndefined();
    expect(getPath(obj, "nope.deep")).toBeUndefined();
    expect(getPath(obj, "content.notanindex")).toBeUndefined();
  });

  it("returns the whole object for an empty path", () => {
    expect(getPath(obj, "")).toBe(obj);
  });
});

describe("interpolate", () => {
  const scope = { who: "world", count: 3, obj: { a: 1 } };

  it("returns the referenced value with its type for a whole-token string", () => {
    expect(interpolate("${count}", scope)).toBe(3);
    expect(interpolate("${obj}", scope)).toEqual({ a: 1 });
  });

  it("stringifies tokens embedded in surrounding text", () => {
    expect(interpolate("hi ${who} x${count}", scope)).toBe("hi world x3");
  });

  it("recurses into arrays and objects", () => {
    expect(interpolate({ m: "${who}", n: ["${count}"] }, scope)).toEqual({
      m: "world",
      n: [3],
    });
  });

  it("reads environment variables via env.", () => {
    process.env.MCPI_TEST_VAR = "fromenv";
    expect(interpolate("${env.MCPI_TEST_VAR}", scope)).toBe("fromenv");
    delete process.env.MCPI_TEST_VAR;
  });

  it("substitutes a missing reference with empty string in text", () => {
    expect(interpolate("a${missing}b", scope)).toBe("ab");
  });
});

/* ------------------------------------------------------------------ */
/* Matchers                                                            */
/* ------------------------------------------------------------------ */

describe("evaluateExpect matchers", () => {
  const result = {
    isError: false,
    text: "Echo: hello",
    content: [{ type: "text", text: "Echo: hello" }],
    structuredContent: { temp: 33, conditions: "Cloudy" },
    names: ["echo", "get-sum"],
  };

  function ok(expectBlock: Record<string, unknown>): boolean {
    return evaluateExpect(result, expectBlock, {}).every((a) => a.ok);
  }

  it("equals (literal shorthand and explicit)", () => {
    expect(ok({ "content.0.text": "Echo: hello" })).toBe(true);
    expect(ok({ "content.0.text": { equals: "Echo: hello" } })).toBe(true);
    expect(ok({ "content.0.text": "nope" })).toBe(false);
    expect(ok({ "structuredContent": { equals: { temp: 33, conditions: "Cloudy" } } })).toBe(true);
  });

  it("contains for strings and arrays", () => {
    expect(ok({ text: { contains: "hello" } })).toBe(true);
    expect(ok({ names: { contains: "echo" } })).toBe(true);
    expect(ok({ names: { contains: "missing" } })).toBe(false);
  });

  it("matches, exists, type", () => {
    expect(ok({ text: { matches: "^Echo: " } })).toBe(true);
    expect(ok({ "structuredContent.temp": { type: "number" } })).toBe(true);
    expect(ok({ "structuredContent.missing": { exists: false } })).toBe(true);
    expect(ok({ "structuredContent.temp": { exists: true } })).toBe(true);
  });

  it("numeric comparisons, oneOf, length", () => {
    expect(ok({ "structuredContent.temp": { gte: 0, lte: 100 } })).toBe(true);
    expect(ok({ "structuredContent.temp": { gt: 33 } })).toBe(false);
    expect(ok({ "structuredContent.conditions": { oneOf: ["Sunny", "Cloudy"] } })).toBe(true);
    expect(ok({ names: { length: 2 } })).toBe(true);
  });

  it("reports a readable message and the actual value on failure", () => {
    const [a] = evaluateExpect(result, { "content.0.text": "bye" }, {});
    expect(a?.ok).toBe(false);
    expect(a?.actual).toBe("Echo: hello");
    expect(a?.message).toContain("to equal");
  });

  it("resolves ${vars} inside expected values", () => {
    expect(evaluateExpect(result, { text: { contains: "${word}" } }, { word: "hello" }).every((a) => a.ok)).toBe(true);
  });
});

describe("deepEqual", () => {
  it("compares nested structures by value", () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Schema validation                                                   */
/* ------------------------------------------------------------------ */

describe("parseSuite", () => {
  it("accepts a minimal valid suite", () => {
    const s = parseSuite(
      { target: "http://x/", cases: [{ name: "c", steps: [{ call: "echo" }] }] },
      "x",
    );
    expect(s.cases[0]?.name).toBe("c");
  });

  it("rejects a step with no action", () => {
    expect(() =>
      parseSuite({ cases: [{ name: "c", steps: [{ expect: {} }] }] }, "x"),
    ).toThrow(/exactly one action/);
  });

  it("rejects a step with two actions", () => {
    expect(() =>
      parseSuite({ cases: [{ name: "c", steps: [{ call: "a", read: "b" }] }] }, "x"),
    ).toThrow(/exactly one action/);
  });

  it("rejects typo'd keys (strict)", () => {
    expect(() =>
      parseSuite(
        { cases: [{ name: "c", steps: [{ call: "a", expects: {} }] }] },
        "x",
      ),
    ).toThrow(/Invalid test suite/);
  });
});

/* ------------------------------------------------------------------ */
/* Runner — with an injected stub session                              */
/* ------------------------------------------------------------------ */

/** Minimal MCP-client stub covering the methods the runner calls. */
function makeStubSession(): Session {
  const client = {
    async callTool({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) {
      const a = args ?? {};
      if (name === "echo") return { content: [{ type: "text", text: String(a.message) }] };
      if (name === "sum") {
        const sum = Number(a.a) + Number(a.b);
        return { content: [{ type: "text", text: `sum=${sum}` }], structuredContent: { sum } };
      }
      if (name === "boom") return { content: [{ type: "text", text: "bad" }], isError: true };
      if (name === "throws") throw new Error("protocol failure");
      throw new Error(`unknown tool ${name}`);
    },
    async readResource({ uri }: { uri: string }) {
      return { contents: [{ uri, text: "hello world" }] };
    },
    async getPrompt({ arguments: args }: { name: string; arguments?: Record<string, string> }) {
      return {
        description: "d",
        messages: [{ role: "user", content: { type: "text", text: `Hi ${args?.who}` } }],
      };
    },
    async listTools() {
      return { tools: [{ name: "echo" }, { name: "sum" }] };
    },
    async listResources() {
      return { resources: [{ name: "r1", uri: "test://r1" }] };
    },
    async listResourceTemplates() {
      return { resourceTemplates: [{ name: "t1", uriTemplate: "test://{id}" }] };
    },
    async listPrompts() {
      return { prompts: [{ name: "greet" }] };
    },
    async complete() {
      return { completion: { values: ["a", "b"], total: 2, hasMore: false } };
    },
  };
  return {
    client,
    target: { kind: "http", url: new URL("http://stub/"), raw: "http://stub/" },
    id: "stub",
    async close() {},
  } as unknown as Session;
}

function inlineSuite(cases: unknown[]): LoadedSuite {
  return {
    source: "inline",
    suite: parseSuite({ target: "http://stub/", cases }, "inline"),
  };
}

const stubConnect = (async () => makeStubSession()) as unknown as typeof connect;

describe("runSuites (stubbed connect)", () => {
  it("passes a multi-step case with capture + chaining across steps", async () => {
    const suites = [
      inlineSuite([
        {
          name: "chain",
          steps: [
            {
              call: "echo",
              with: { message: "hello" },
              expect: { isError: false, "content.0.text": { equals: "hello" } },
              capture: { first: "content.0.text" },
            },
            {
              call: "echo",
              with: { message: "${first}!" },
              expect: { "content.0.text": { equals: "hello!" } },
            },
          ],
        },
      ]),
    ];
    const report = await runSuites(suites, { connectFn: stubConnect });
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(1);
    expect(report.cases[0]?.steps).toHaveLength(2);
  });

  it("normalizes structured content, list names, read/get text", async () => {
    const report = await runSuites(
      [
        inlineSuite([
          { name: "structured", steps: [{ call: "sum", with: { a: 2, b: 3 }, expect: { "structuredContent.sum": 5, text: { contains: "sum=5" } } }] },
          { name: "list", steps: [{ list: "tools", expect: { names: { contains: "sum" } } }] },
          { name: "read", steps: [{ read: "test://greeting", expect: { text: { contains: "hello world" } } }] },
          { name: "get", steps: [{ get: "greet", with: { who: "Sam" }, expect: { text: { contains: "Hi Sam" } } }] },
          { name: "complete", steps: [{ complete: { refType: "prompt", ref: "greet", argument: "who" }, expect: { "completion.values": { length: 2 } } }] },
        ]),
      ],
      { connectFn: stubConnect },
    );
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(5);
  });

  it("treats isError:true results as assertable, not thrown", async () => {
    const report = await runSuites(
      [inlineSuite([{ name: "err", steps: [{ call: "boom", expect: { isError: true } }] }])],
      { connectFn: stubConnect },
    );
    expect(report.ok).toBe(true);
  });

  it("records a step error when the MCP call throws", async () => {
    const report = await runSuites(
      [inlineSuite([{ name: "throws", steps: [{ call: "throws" }] }])],
      { connectFn: stubConnect },
    );
    expect(report.ok).toBe(false);
    expect(report.cases[0]?.steps[0]?.error).toContain("protocol failure");
  });

  it("fails a case with a clear error when no target is resolvable", async () => {
    const suite = parseSuite({ cases: [{ name: "no-target", steps: [{ call: "echo" }] }] }, "inline");
    const report = await runSuites([{ source: "inline", suite }], { connectFn: stubConnect });
    expect(report.ok).toBe(false);
    expect(report.cases[0]?.error).toMatch(/no target/);
  });

  it("honors --filter and --bail semantics", async () => {
    const suites = [
      inlineSuite([
        { name: "keep me", steps: [{ call: "echo", with: { message: "x" }, expect: { "content.0.text": "x" } }] },
        { name: "skip me", steps: [{ call: "echo", with: { message: "y" }, expect: { "content.0.text": "y" } }] },
      ]),
    ];
    const filtered = await runSuites(suites, { connectFn: stubConnect, filter: "keep" });
    expect(filtered.cases).toHaveLength(1);
    expect(filtered.cases[0]?.name).toBe("keep me");

    const bailSuites = [
      inlineSuite([
        { name: "boom1", steps: [{ call: "echo", with: { message: "x" }, expect: { "content.0.text": "WRONG" } }] },
        { name: "never runs", steps: [{ call: "echo", with: { message: "y" }, expect: { "content.0.text": "y" } }] },
      ]),
    ];
    const bailed = await runSuites(bailSuites, { connectFn: stubConnect, bail: true });
    expect(bailed.cases).toHaveLength(1);
  });

  it("seeds variables from RunOptions.vars (CLI --var)", async () => {
    const report = await runSuites(
      [inlineSuite([{ name: "vars", steps: [{ call: "echo", with: { message: "${who}" }, expect: { "content.0.text": "World" } }] }])],
      { connectFn: stubConnect, vars: { who: "World" } },
    );
    expect(report.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Reporters                                                           */
/* ------------------------------------------------------------------ */

describe("reporters", () => {
  const report: RunReport = {
    passed: 1,
    failed: 1,
    durationMs: 20,
    ok: false,
    cases: [
      { name: "good", source: "s.yaml", target: "t", ok: true, durationMs: 5, steps: [] },
      {
        name: "bad <one>",
        source: "s.yaml",
        target: "t",
        ok: false,
        durationMs: 8,
        steps: [
          {
            index: 0,
            action: "call echo",
            ok: false,
            durationMs: 8,
            assertions: [
              { path: "content.0.text", matcher: "contains", ok: false, message: 'expected "x" to contain "widget"', expected: "widget", actual: "x" },
            ],
          },
        ],
      },
    ],
  };

  it("console reporter shows pass/fail marks and the failure detail", () => {
    const out = renderReport("console", report, { color: false });
    expect(out).toContain("good");
    expect(out).toContain("widget");
    expect(out).toContain("1 passed, 1 failed");
  });

  it("junit reporter emits well-formed, escaped XML", () => {
    const xml = renderReport("junit", report);
    expect(xml).toContain('<testsuites tests="2" failures="1"');
    expect(xml).toContain('name="bad &lt;one&gt;"');
    expect(xml).toContain("<failure");
  });

  it("tap reporter emits TAP version 13 framing", () => {
    const tap = renderReport("tap", report);
    expect(tap.startsWith("TAP version 13\n1..2")).toBe(true);
    expect(tap).toContain("ok 1 - good");
    expect(tap).toContain("not ok 2 - bad <one>");
  });

  it("json reporter round-trips the report", () => {
    expect(JSON.parse(renderReport("json", report)).failed).toBe(1);
  });

  it("teamcity reporter brackets suites and emits test lifecycle messages", () => {
    const out = renderReport("teamcity", report);
    expect(out).toContain("##teamcity[testSuiteStarted name='s.yaml']");
    expect(out).toContain("##teamcity[testStarted name='good'");
    expect(out).toContain("##teamcity[testFinished name='good' duration='5']");
    expect(out).toContain("##teamcity[testFailed name='bad <one>'");
    expect(out).toContain("##teamcity[testSuiteFinished name='s.yaml']");
  });

  it("teamcity stream escapes special chars and closes suites on transition", () => {
    const lines: string[] = [];
    const stream = createTeamCityStream((l) => lines.push(l));
    stream.onCaseStart({ name: "a", source: "f1" });
    stream.onCaseComplete({ name: "a", source: "f1", target: "t", ok: true, durationMs: 3, steps: [] });
    stream.onCaseStart({ name: "b'x", source: "f2" });
    stream.onCaseComplete({
      name: "b'x",
      source: "f2",
      target: "t",
      ok: false,
      durationMs: 5,
      steps: [
        {
          index: 0,
          action: "call x",
          ok: false,
          durationMs: 5,
          assertions: [
            { path: "p", matcher: "equals", ok: false, message: "line1\nline2", expected: 1, actual: 2 },
          ],
        },
      ],
    });
    stream.end();
    const out = lines.join("\n");
    // The first suite is closed before the second opens.
    expect(out.indexOf("testSuiteFinished name='f1'")).toBeGreaterThan(-1);
    expect(out.indexOf("testSuiteFinished name='f1'")).toBeLessThan(
      out.indexOf("testSuiteStarted name='f2'"),
    );
    expect(out).toContain("name='b|'x'"); // escaped single quote
    expect(out).toContain("line1|nline2"); // escaped newline in details
    expect(out.endsWith("testSuiteFinished name='f2']")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Integration — real connect against an in-memory HTTP MCP server     */
/* ------------------------------------------------------------------ */

describe("end-to-end against a real MCP server", () => {
  let srv: SessionTestServer | null = null;
  let tmpDir = "";
  let originalXDG: string | undefined;

  beforeAll(async () => {
    originalXDG = process.env.XDG_CONFIG_HOME;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-fw-"));
    process.env.XDG_CONFIG_HOME = tmpDir;
    srv = await startSessionServer();
  });

  afterAll(async () => {
    await srv?.close();
    if (originalXDG === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXDG;
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads a YAML suite from disk and runs it via connect()", async () => {
    const dir = path.join(tmpDir, "suites");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "echo.yaml"),
      [
        `target: "${srv!.url}"`,
        "cases:",
        "  - name: echo round-trips text",
        "    steps:",
        "      - call: echo",
        "        with: { text: hi }",
        "        expect:",
        "          isError: false",
        '          content.0.text: { equals: "hi" }',
        "        capture:",
        "          echoed: content.0.text",
        "      - call: echo",
        '        with: { text: "${echoed}!" }',
        '        expect: { "content.0.text": { equals: "hi!" } }',
      ].join("\n"),
    );

    const suites = await loadSuites([dir]);
    expect(suites).toHaveLength(1);

    const report = await runSuites(suites, { connectOptions: { quiet: true } });
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(1);
  });
});
