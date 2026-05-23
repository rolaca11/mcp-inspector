import { describe, it, expect } from "vitest";
import {
  serverNameInput,
  readResourceInput,
  callToolInput,
  getPromptInput,
  completeInput,
  configAddInput,
  configRemoveInput,
} from "../trpc/schemas.js";

describe("serverNameInput", () => {
  it("accepts valid server name", () => {
    expect(serverNameInput.parse({ serverName: "my-server" })).toEqual({
      serverName: "my-server",
    });
  });

  it("rejects empty server name", () => {
    expect(() => serverNameInput.parse({ serverName: "" })).toThrow();
  });

  it("rejects missing serverName", () => {
    expect(() => serverNameInput.parse({})).toThrow();
  });
});

describe("readResourceInput", () => {
  it("accepts single resource item", () => {
    const input = {
      serverName: "s",
      items: { uri: "test://resource" },
    };
    const result = readResourceInput.parse(input);
    expect(result.items).toEqual({ uri: "test://resource" });
  });

  it("accepts array of resource items", () => {
    const input = {
      serverName: "s",
      items: [{ uri: "test://a" }, { uri: "test://b" }],
    };
    const result = readResourceInput.parse(input);
    expect(Array.isArray(result.items)).toBe(true);
    if (Array.isArray(result.items)) {
      expect(result.items).toHaveLength(2);
    }
  });

  it("rejects item without uri", () => {
    expect(() =>
      readResourceInput.parse({ serverName: "s", items: { name: "x" } }),
    ).toThrow();
  });
});

describe("callToolInput", () => {
  it("accepts single tool call with arguments", () => {
    const input = {
      serverName: "s",
      items: { name: "my-tool", arguments: { key: "value" } },
    };
    const result = callToolInput.parse(input);
    expect(result.items).toEqual({
      name: "my-tool",
      arguments: { key: "value" },
    });
  });

  it("accepts tool call without arguments", () => {
    const input = { serverName: "s", items: { name: "my-tool" } };
    const result = callToolInput.parse(input);
    expect(result.items).toEqual({ name: "my-tool" });
  });

  it("accepts array of tool calls", () => {
    const input = {
      serverName: "s",
      items: [
        { name: "tool-a" },
        { name: "tool-b", arguments: { x: 1 } },
      ],
    };
    const result = callToolInput.parse(input);
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("rejects item without name", () => {
    expect(() =>
      callToolInput.parse({
        serverName: "s",
        items: { arguments: {} },
      }),
    ).toThrow();
  });
});

describe("getPromptInput", () => {
  it("accepts single prompt with string arguments", () => {
    const input = {
      serverName: "s",
      items: { name: "my-prompt", arguments: { lang: "en" } },
    };
    const result = getPromptInput.parse(input);
    expect(result.items).toEqual({
      name: "my-prompt",
      arguments: { lang: "en" },
    });
  });

  it("accepts prompt without arguments", () => {
    const input = { serverName: "s", items: { name: "my-prompt" } };
    expect(getPromptInput.parse(input).items).toEqual({
      name: "my-prompt",
    });
  });

  it("rejects non-string argument values", () => {
    const input = {
      serverName: "s",
      items: { name: "p", arguments: { key: 123 } },
    };
    expect(() => getPromptInput.parse(input)).toThrow();
  });

  it("accepts array of prompts", () => {
    const input = {
      serverName: "s",
      items: [{ name: "p1" }, { name: "p2", arguments: { a: "b" } }],
    };
    const result = getPromptInput.parse(input);
    expect(Array.isArray(result.items)).toBe(true);
  });
});

describe("completeInput", () => {
  it("accepts prompt completion", () => {
    const input = {
      serverName: "s",
      items: {
        refType: "prompt" as const,
        ref: "my-prompt",
        argument: "lang",
        value: "en",
      },
    };
    const result = completeInput.parse(input);
    expect(result.items).toMatchObject({
      refType: "prompt",
      ref: "my-prompt",
    });
  });

  it("accepts resource completion", () => {
    const input = {
      serverName: "s",
      items: {
        refType: "resource" as const,
        ref: "test://{id}",
        argument: "id",
      },
    };
    const result = completeInput.parse(input);
    expect(result.items).toMatchObject({ refType: "resource" });
  });

  it("accepts with context map", () => {
    const input = {
      serverName: "s",
      items: {
        refType: "prompt" as const,
        ref: "p",
        argument: "a",
        context: { other: "value" },
      },
    };
    const result = completeInput.parse(input);
    expect(result.items).toMatchObject({
      context: { other: "value" },
    });
  });

  it("rejects invalid refType", () => {
    expect(() =>
      completeInput.parse({
        serverName: "s",
        items: { refType: "invalid", ref: "p", argument: "a" },
      }),
    ).toThrow();
  });

  it("accepts batch of completions", () => {
    const input = {
      serverName: "s",
      items: [
        { refType: "prompt" as const, ref: "p", argument: "a" },
        { refType: "resource" as const, ref: "r", argument: "b" },
      ],
    };
    const result = completeInput.parse(input);
    expect(Array.isArray(result.items)).toBe(true);
  });
});

describe("configAddInput", () => {
  it("accepts stdio config", () => {
    const input = {
      name: "my-server",
      config: { command: "node", args: ["server.js"] },
    };
    expect(configAddInput.parse(input).name).toBe("my-server");
  });

  it("accepts HTTP config", () => {
    const input = {
      name: "my-server",
      config: { url: "https://example.com" },
    };
    expect(configAddInput.parse(input).name).toBe("my-server");
  });

  it("rejects config without command or url", () => {
    expect(() =>
      configAddInput.parse({
        name: "my-server",
        config: { args: ["test"] },
      }),
    ).toThrow();
  });

  it("rejects empty name", () => {
    expect(() =>
      configAddInput.parse({ name: "", config: { command: "echo" } }),
    ).toThrow();
  });

  it("accepts force flag", () => {
    const input = {
      name: "my-server",
      config: { command: "echo" },
      force: true,
    };
    expect(configAddInput.parse(input).force).toBe(true);
  });
});

describe("configRemoveInput", () => {
  it("accepts valid name", () => {
    expect(configRemoveInput.parse({ name: "server" }).name).toBe("server");
  });

  it("rejects empty name", () => {
    expect(() => configRemoveInput.parse({ name: "" })).toThrow();
  });
});
