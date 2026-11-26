import readline from "node:readline";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import type {
  ElicitationFormParams,
  ElicitationRequestedSchema,
  ElicitationUrlParams,
} from "@rolaca11/mcp-inspector-core/elicitation";

import {
  createInteractiveElicitationHandler,
  createScriptedElicitationHandler,
  resolveCliElicitationHandler,
  type AskLine,
} from "../elicitation-prompt.js";
import { createReplLineBridge } from "../repl.js";

const schema: ElicitationRequestedSchema = {
  type: "object",
  properties: {
    name: { type: "string", title: "Name", minLength: 2 },
    email: { type: "string", format: "email" },
    subscribe: { type: "boolean", default: true },
    age: { type: "integer", minimum: 0 },
    ratio: { type: "number", maximum: 1 },
    color: { type: "string", enum: ["red", "green"], default: "green" },
    size: { type: "string", oneOf: [{ const: "s", title: "Small" }, { const: "l", title: "Large" }] },
    legacy: { type: "string", enum: ["a", "b"], enumNames: ["Alpha", "Beta"] },
    tags: { type: "array", minItems: 1, items: { type: "string", enum: ["x", "y", "z"] } },
    roles: { type: "array", items: { anyOf: [{ const: "admin", title: "Admin" }, { const: "dev", title: "Developer" }] } },
  },
  required: ["name", "tags"],
};

const form = (requestedSchema: ElicitationRequestedSchema = schema): ElicitationFormParams => ({
  mode: "form",
  message: "Tell me about yourself",
  requestedSchema,
});

const url = (href: string): ElicitationUrlParams => ({
  mode: "url",
  message: "Connect your account",
  url: href,
  elicitationId: "abc",
});

function scriptedInput(answers: string[]) {
  const prompts: string[] = [];
  const askLine: AskLine = async (prompt) => {
    prompts.push(prompt);
    const next = answers.shift();
    if (next === undefined) throw new Error(`unexpected prompt: ${prompt}`);
    return next;
  };
  let written = "";
  const output = { write: (chunk: string) => (written += chunk) };
  return { askLine, prompts, output, written: () => written, remaining: answers };
}

describe("createScriptedElicitationHandler", () => {
  it("reuses a single response for every elicitation", async () => {
    const handler = createScriptedElicitationHandler('{"action":"accept","content":{"name":"Ada","tags":["x"]}}');
    const expected = { action: "accept", content: { name: "Ada", subscribe: true, color: "green", tags: ["x"] } };
    await expect(handler(form(), {})).resolves.toEqual(expected);
    await expect(handler(form(), {})).resolves.toEqual(expected);
  });

  it("consumes an array of responses in order", async () => {
    const handler = createScriptedElicitationHandler(
      '[{"action":"decline","content":{"x":1}},{"action":"accept","content":{"ignored":true}}]',
    );
    await expect(handler(form(), {})).resolves.toMatchObject({ action: "decline" });
    await expect(handler(url("https://x.test"), {})).resolves.toMatchObject({ action: "accept" });
    await expect(handler(form(), {})).rejects.toThrow(/no response left/);
  });

  it("rejects responses that do not match the requested schema", async () => {
    const handler = createScriptedElicitationHandler('{"action":"accept","content":{"name":"A"}}');
    await expect(handler(form(), {})).rejects.toThrow(/name: Must be at least 2 characters; tags: This field is required/);
  });

  it.each([
    ["not json", /valid JSON/],
    ['"accept"', /must be an object/],
    ['{"action":"maybe"}', /action must be/],
    ['{"action":"accept","content":[1]}', /content must be an object/],
    ['{"action":"accept","content":{"a":{"b":1}}}', /content\.a must be/],
    ['[{"action":"accept"},{"nope":1}]', /\[1\]\.action/],
  ])("rejects invalid input %s", (raw, error) => {
    expect(() => createScriptedElicitationHandler(raw)).toThrow(error);
  });
});

describe("resolveCliElicitationHandler", () => {
  it("omits elicitation with --no-elicitation or in headless runs", () => {
    expect(resolveCliElicitationHandler({ elicitation: false, elicitResponse: '{"action":"cancel"}' })).toBeUndefined();
    expect(resolveCliElicitationHandler({}, { interactive: false })).toBeUndefined();
  });

  it("prefers a scripted response and falls back to the interactive prompt on a TTY", async () => {
    const scripted = resolveCliElicitationHandler({ elicitResponse: '{"action":"cancel"}' }, { interactive: true });
    await expect(scripted!(form(), {})).resolves.toEqual({ action: "cancel" });
    const io = scriptedInput(["d"]);
    const interactive = resolveCliElicitationHandler({}, { interactive: true, askLine: io.askLine, output: io.output });
    expect(interactive).toBeTypeOf("function");
    await expect(interactive!(form(), {})).resolves.toEqual({ action: "decline" });
  });
});

describe("createInteractiveElicitationHandler (form)", () => {
  it("fills every field kind, applying defaults and re-prompting invalid answers", async () => {
    const io = scriptedInput([
      "",
      "A",
      "Ada",
      "nope",
      "ada@example.com",
      "",
      "-1",
      "1.5",
      "41",
      "2",
      "0.5",
      "purple",
      "",
      "Large",
      "1",
      "",
      "x, 3",
      "admin,Developer",
    ]);
    const handler = createInteractiveElicitationHandler({ askLine: io.askLine, output: io.output });
    const result = await handler(form(), {});
    expect(result).toEqual({
      action: "accept",
      content: {
        name: "Ada",
        email: "ada@example.com",
        subscribe: true,
        age: 41,
        ratio: 0.5,
        color: "green",
        size: "l",
        legacy: "a",
        tags: ["x", "z"],
        roles: ["admin", "dev"],
      },
    });
    expect(io.remaining).toEqual([]);
    const out = io.written();
    expect(out).toContain("Tell me about yourself");
    expect(out).toContain("Must be at least 2 characters");
    expect(out).toContain("Enter a valid email address");
    expect(out).toContain("Must be at least 0");
    expect(out).toContain("Expected a whole number");
    expect(out).toContain("Must be at most 1");
    expect(out).toContain('"purple" is not one of the options');
    expect(out).toContain("This field is required");
    expect(out).toContain("Alpha");
    expect(io.prompts.some((p) => p.includes("default: green"))).toBe(true);
  });

  it("handles decline and cancel at the start of the form", async () => {
    for (const [answer, action] of [["d", "decline"], ["cancel", "cancel"]] as const) {
      const io = scriptedInput([answer]);
      const handler = createInteractiveElicitationHandler({ askLine: io.askLine, output: io.output });
      await expect(handler(form(), {})).resolves.toEqual({ action });
    }
  });

  it("lets the user cancel in the middle of the form", async () => {
    const io = scriptedInput(["y", "Ada", ":cancel"]);
    const handler = createInteractiveElicitationHandler({ askLine: io.askLine, output: io.output });
    await expect(handler(form(), {})).resolves.toEqual({ action: "cancel" });
  });

  it("asks one elicitation at a time when several arrive together", async () => {
    const single: ElicitationRequestedSchema = { type: "object", properties: { v: { type: "string" } } };
    const io = scriptedInput(["", "first", "", "second"]);
    const handler = createInteractiveElicitationHandler({ askLine: io.askLine, output: io.output });
    const [a, b] = await Promise.all([handler(form(single), {}), handler(form(single), {})]);
    expect(a).toEqual({ action: "accept", content: { v: "first" } });
    expect(b).toEqual({ action: "accept", content: { v: "second" } });
  });

  it("returns cancel when input closes and rethrows when the server aborts", async () => {
    const closed = createInteractiveElicitationHandler({
      askLine: async () => {
        throw new Error("input closed");
      },
      output: { write: () => true },
    });
    await expect(closed(form(), {})).resolves.toEqual({ action: "cancel" });

    const controller = new AbortController();
    controller.abort(new Error("server cancelled"));
    const aborted = createInteractiveElicitationHandler({ askLine: async () => "y", output: { write: () => true } });
    await expect(aborted(form(), { signal: controller.signal })).rejects.toThrow("server cancelled");
  });
});

describe("createInteractiveElicitationHandler (url)", () => {
  it("requires an explicit choice and opens the URL in the browser on 'o'", async () => {
    const opened: string[] = [];
    const io = scriptedInput(["", "o"]);
    const handler = createInteractiveElicitationHandler({
      askLine: io.askLine,
      output: io.output,
      openUrl: (u) => {
        opened.push(u);
      },
    });
    await expect(handler(url("https://auth.example.com/start?x=1"), {})).resolves.toEqual({ action: "accept" });
    expect(opened).toEqual(["https://auth.example.com/start?x=1"]);
    expect(io.written()).toContain("Please answer one of");
    expect(io.written()).toContain("auth.example.com");
    expect(io.written()).toContain("https://auth.example.com");
    expect(io.written()).toContain("abc");
  });

  it("accepts without opening, declines, and cancels", async () => {
    for (const [answer, action] of [["a", "accept"], ["d", "decline"], ["c", "cancel"]] as const) {
      const opened: string[] = [];
      const io = scriptedInput(["huh", answer]);
      const handler = createInteractiveElicitationHandler({
        askLine: io.askLine,
        output: io.output,
        openUrl: (u) => {
          opened.push(u);
        },
      });
      await expect(handler(url("http://localhost:3000/cb"), {})).resolves.toEqual({ action });
      expect(opened).toEqual([]);
      expect(io.written()).toContain("Please answer one of");
    }
  });

  it("still accepts when the browser cannot be opened", async () => {
    const io = scriptedInput(["o"]);
    const handler = createInteractiveElicitationHandler({
      askLine: io.askLine,
      output: io.output,
      openUrl: () => {
        throw new Error("no browser");
      },
    });
    await expect(handler(url("https://x.test"), {})).resolves.toEqual({ action: "accept" });
    expect(io.written()).toContain("visit the URL above manually");
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd"])(
    "declines without prompting for %s",
    async (href) => {
      const io = scriptedInput([]);
      const opened: string[] = [];
      const handler = createInteractiveElicitationHandler({
        askLine: io.askLine,
        output: io.output,
        openUrl: (u) => {
          opened.push(u);
        },
      });
      await expect(handler(url(href), {})).resolves.toEqual({ action: "decline" });
      expect(io.prompts).toEqual([]);
      expect(opened).toEqual([]);
      expect(io.written()).toContain("Refusing to open");
    },
  );
});

describe("createReplLineBridge", () => {
  function setup() {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const rl = readline.createInterface({ input, output, terminal: false });
    const lines: string[] = [];
    rl.on("line", (line) => lines.push(line));
    return { input, rl, lines };
  }

  it("answers questions on the REPL interface without emitting REPL lines", async () => {
    const { input, rl, lines } = setup();
    const bridge = createReplLineBridge(async () => {
      throw new Error("fallback should not be used");
    });
    let busy = true;
    const detach = bridge.attach(rl, () => busy);
    rl.pause();

    const answer = bridge.askLine("name? ");
    input.write("Ada\n");
    await expect(answer).resolves.toBe("Ada");

    input.write("tools\n");
    await new Promise((r) => setTimeout(r, 20));
    expect(lines).toEqual([]);

    busy = false;
    rl.resume();
    await new Promise((r) => setTimeout(r, 20));
    expect(lines).toEqual(["tools"]);
    detach();
    rl.close();
  });

  it("rejects pending questions when the interface closes or the signal aborts", async () => {
    const { rl } = setup();
    const bridge = createReplLineBridge();
    bridge.attach(rl, () => false);
    const controller = new AbortController();
    const aborted = bridge.askLine("q? ", { signal: controller.signal });
    controller.abort(new Error("server cancelled"));
    await expect(aborted).rejects.toThrow("server cancelled");

    const closed = bridge.askLine("q? ");
    rl.close();
    await expect(closed).rejects.toThrow("input closed");
  });

  it("uses the fallback before a REPL attaches and after it detaches", async () => {
    const asked: string[] = [];
    const bridge = createReplLineBridge(async (prompt) => {
      asked.push(prompt);
      return "fallback";
    });
    await expect(bridge.askLine("early? ")).resolves.toBe("fallback");
    const { rl } = setup();
    bridge.attach(rl, () => false)();
    await expect(bridge.askLine("late? ")).resolves.toBe("fallback");
    expect(asked).toEqual(["early? ", "late? "]);
    rl.close();
  });
});
