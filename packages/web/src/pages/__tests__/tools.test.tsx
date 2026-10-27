// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/data/api";
import { useConnectionStore } from "@/stores/connection-store";
import { useResultStore } from "@/stores/result-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useToolArgsStore } from "@/stores/tool-args-store";
import { useToolSchemaStore } from "@/stores/tool-schema-store";
import { ToolsPage } from "../tools";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = createRange();
    range.getClientRects = () => Object.assign([], { item: () => null });
    range.getBoundingClientRect = () => new DOMRect();
    return range;
  });
  vi.spyOn(api, "savedFormsList").mockResolvedValue({ scoped: [], global: [] });
  vi.spyOn(api, "callTool").mockResolvedValue([]);
  useToolArgsStore.setState({ cache: {} });
  useResultStore.setState({ cache: {} });
  useSelectionStore.setState({ cache: {} });
  useToolSchemaStore.setState({ overrides: {} });
  useConnectionStore.setState({
    ...useConnectionStore.getInitialState(),
    server: {
      id: "server",
      name: "server",
      source: "/tmp/mcp.json",
      sourceLabel: "project",
      transport: "http",
      target: "http://localhost/mcp",
    },
    connectionState: "connected",
    data: {
      server: { name: "server" },
      capabilities: { tools: {} },
      resources: [],
      resourceTemplates: [],
      prompts: [],
      skills: [],
      tools: [{
        name: "search",
        description: "Search **documents**.",
        inputSchema: {
          type: "object",
          properties: {
            ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [
              `field${i}`,
              { type: "string", description: `Description for **field ${i}**.` },
            ])),
            filters: { type: "object" },
          },
          required: ["field0"],
        },
      }, {
        name: "lookup",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      }],
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function button(text: string) {
  const match = [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === text);
  expect(match).toBeDefined();
  return match!;
}

function editor() {
  return EditorView.findFromDOM(container.querySelector('[role="textbox"][aria-label="--args"]') as HTMLElement)!;
}

async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    input.focus();
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function editJson(value: string) {
  await act(async () => {
    const view = editor();
    view.focus();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  });
}

async function openTools() {
  await act(async () => root.render(<TooltipProvider><ToolsPage /></TooltipProvider>));
}

describe("tool argument editing", () => {
  it("preserves the typed draft and focus while updating the JSON preview", async () => {
    await openTools();
    const input = container.querySelector("input")!;
    const filters = container.querySelector("textarea")!;
    const draft = '{ "name": "Ada" }';
    expect(button("Call tool").disabled).toBe(true);

    await type(filters, draft);
    for (const value of ["a", "ab", "abc"]) {
      await type(input, value);
      expect(input.value).toBe(value);
      expect(document.activeElement).toBe(input);
      expect(filters.value).toBe(draft);
      expect(JSON.parse(editor().state.doc.toString())).toEqual({ field0: value, filters: { name: "Ada" } });
    }

    expect(button("Call tool").disabled).toBe(false);
    await type(input, "");
    expect(button("Call tool").disabled).toBe(true);
  });

  it("updates the form from JSON and sends the edited arguments when calling the tool", async () => {
    await openTools();
    const args = { field0: "documents", filters: { name: "Ada" } };

    await editJson(JSON.stringify(args));

    expect(container.querySelector("input")!.value).toBe("documents");
    expect(JSON.parse(container.querySelector("textarea")!.value)).toEqual({ name: "Ada" });
    expect(button("Call tool").disabled).toBe(false);
    await act(async () => button("Call tool").click());
    expect(api.callTool).toHaveBeenCalledExactlyOnceWith("server", { name: "search", arguments: args });
  });

  it("keeps valid field values while JSON is incomplete and restores the preview on blur", async () => {
    await openTools();
    const input = container.querySelector("input")!;
    await type(input, "documents");

    await editJson("{");

    expect(editor().state.doc.toString()).toBe("{");
    expect(container.textContent).toContain("invalid JSON");
    expect(input.value).toBe("documents");
    await act(async () => input.focus());
    expect(JSON.parse(editor().state.doc.toString())).toEqual({ field0: "documents" });
    expect(container.textContent).not.toContain("invalid JSON");
  });

  it("keeps each tool's entered arguments when switching between tools", async () => {
    await openTools();
    await type(container.querySelector("input")!, "documents");

    await act(async () => button("lookup").click());
    expect(container.querySelector("input")!.value).toBe("");
    await type(container.querySelector("input")!, "item-42");
    await act(async () => button("search").click());
    expect(container.querySelector("input")!.value).toBe("documents");
    expect(JSON.parse(editor().state.doc.toString())).toEqual({ field0: "documents" });
    await act(async () => button("lookup").click());
    expect(container.querySelector("input")!.value).toBe("item-42");
    expect(JSON.parse(editor().state.doc.toString())).toEqual({ id: "item-42" });
  });
});
