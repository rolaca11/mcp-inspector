// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ElicitationRequestParams,
  PendingElicitation,
} from "@rolaca11/mcp-inspector-core/elicitation";

import { ElicitationPanel } from "@/components/elicitation-panel";
import { ErrorMessage } from "@/components/error-message";
import { ElicitationBanner } from "@/components/shell/elicitation-banner";
import { ApiError, api } from "@/data/api";
import type { MCPServer } from "@/data/types";
import { useActivityStore } from "@/stores/activity-store";
import { useConnectionStore } from "@/stores/connection-store";
import { useElicitationStore } from "@/stores/elicitation-store";

const server: MCPServer = {
  id: "server",
  name: "server",
  source: "/tmp/mcp.json",
  sourceLabel: "project",
  transport: "http",
  target: "http://localhost/mcp",
};
const other: MCPServer = { ...server, id: "other", name: "other" };

const formParams: ElicitationRequestParams = {
  mode: "form",
  message: "Tell us about **you**",
  requestedSchema: {
    type: "object",
    properties: {
      name: { type: "string", title: "Name", minLength: 2, default: "Ada" },
      email: { type: "string", format: "email" },
      website: { type: "string", format: "uri" },
      birthday: { type: "string", format: "date" },
      meetAt: { type: "string", format: "date-time" },
      age: { type: "integer", minimum: 18 },
      ratio: { type: "number", maximum: 1 },
      subscribe: { type: "boolean", default: true },
      color: { type: "string", enum: ["red", "green"] },
      size: { type: "string", oneOf: [{ const: "s", title: "Small" }, { const: "l", title: "Large" }] },
      tier: { type: "string", enum: ["a", "b"], enumNames: ["Alpha", "Beta"] },
      country: { type: "string", enum: ["at", "be", "ch", "de", "es", "fr"] },
      tags: { type: "array", items: { type: "string", enum: ["x", "y", "z"] }, minItems: 1, maxItems: 2 },
      langs: {
        type: "array",
        items: { anyOf: [{ const: "en", title: "English" }, { const: "fr", title: "French" }] },
        default: ["en"],
      },
    },
    required: ["name", "email", "age", "tags"],
  },
};

const urlParams: ElicitationRequestParams = {
  mode: "url",
  message: "Sign in to continue",
  url: "https://auth.example.com/start?state=abc",
  elicitationId: "el-1",
};

function pendingOf(id: string, params: ElicitationRequestParams, serverName = "server"): PendingElicitation {
  return { id, serverName, createdAt: "2026-11-25T10:00:00.000Z", params };
}

let container: HTMLDivElement;
let root: Root;
let serverSide: PendingElicitation[];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  serverSide = [];
  vi.spyOn(api, "pendingElicitations").mockImplementation(async () => ({
    pending: [...serverSide],
    completions: useElicitationStore.getState().completions,
  }));
  vi.spyOn(api, "respondElicitation").mockImplementation(async ({ id, action, content }) => {
    const item = serverSide.find((p) => p.id === id)!;
    serverSide = serverSide.filter((p) => p.id !== id);
    return {
      ok: true,
      id,
      serverName: item.serverName,
      params: item.params,
      result: content ? { action, content } : { action },
      durationMs: 5,
    };
  });
  useActivityStore.getState().clear();
  useElicitationStore.setState(useElicitationStore.getInitialState());
  useConnectionStore.setState({
    ...useConnectionStore.getInitialState(),
    server,
    connectionState: "connected",
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

async function show(...items: PendingElicitation[]) {
  serverSide = [...items];
  await act(async () => useElicitationStore.setState({ pending: [...items] }));
}

async function renderPanel(onSelectServer = vi.fn()) {
  await act(async () =>
    root.render(
      <>
        <ElicitationBanner servers={[server, other]} active={server} onSelectServer={onSelectServer} />
        <ElicitationPanel serverName={server.id} />
      </>,
    ),
  );
  return onSelectServer;
}

function panel() {
  return container.querySelector<HTMLElement>('[data-testid="elicitation-panel"]');
}

function button(text: string, scope: ParentNode = container) {
  const match = [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  expect(match, `button "${text}"`).toBeDefined();
  return match!;
}

function field(name: string) {
  return container.querySelector<HTMLElement>(`[data-field="${name}"]`)!;
}

function input(name: string) {
  return field(name).querySelector<HTMLInputElement>("input")!;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function type(element: HTMLInputElement, value: string, blur = true) {
  await act(async () => {
    element.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (blur) await act(async () => element.blur());
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function pressKey(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

describe("form elicitation", () => {
  it("renders inline rather than in a modal dialog with every primitive schema type and prefilled defaults", async () => {
    await renderPanel();
    await show(pendingOf("a", formParams));

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(panel()?.textContent).toContain("Form elicitation");
    expect(panel()?.textContent).toContain("Tell us about **you**");
    expect(panel()?.querySelector("strong")).toBeNull();
    expect(input("name").value).toBe("Ada");
    expect(input("email").type).toBe("email");
    expect(input("website").type).toBe("url");
    expect(input("birthday").type).toBe("date");
    expect(input("meetAt").type).toBe("text");
    expect(field("meetAt").textContent).toContain("RFC 3339");
    expect(input("age").type).toBe("number");
    expect(input("age").step).toBe("1");
    expect(input("ratio").step).toBe("any");
    expect(button("true", field("subscribe")).getAttribute("aria-pressed")).toBe("true");
    expect(button("false", field("subscribe")).getAttribute("aria-pressed")).toBe("false");
    expect(button("red", field("color")).getAttribute("role")).toBe("radio");
    expect(button("Large", field("size")).getAttribute("aria-checked")).toBe("false");
    expect(button("Beta", field("tier"))).toBeDefined();
    const country = field("country").querySelector("select")!;
    expect([...country.options].map((o) => o.value)).toEqual(["", "at", "be", "ch", "de", "es", "fr"]);
    expect(button("English", field("langs")).getAttribute("aria-checked")).toBe("true");
    expect(field("tags").textContent).toContain("pick at least 1 · pick at most 2");
    expect(button("Accept").disabled).toBe(true);
  });

  it("shows inline errors for constraint violations once a field is touched", async () => {
    await renderPanel();
    await show(pendingOf("a", formParams));

    expect(field("email").querySelector('[role="alert"]')).toBeNull();
    await type(input("name"), "A");
    expect(field("name").textContent).toContain("Must be at least 2 characters");
    await type(input("email"), "nope");
    expect(field("email").textContent).toContain("Enter a valid email address");
    await type(input("age"), "12");
    expect(field("age").textContent).toContain("Must be at least 18");
    await type(input("age"), "18.5");
    expect(field("age").textContent).toContain("Expected a whole number");
    await type(input("meetAt"), "2026-01-31 09:30");
    expect(field("meetAt").textContent).toContain("Enter a valid date-time");
    await click(button("x", field("tags")));
    await click(button("y", field("tags")));
    await click(button("z", field("tags")));
    expect(field("tags").textContent).toContain("Select at most 2 options");
    await click(button("y", field("tags")));
    await click(button("z", field("tags")));
    await click(button("x", field("tags")));
    expect(field("tags").textContent).toContain("This field is required");
    expect(input("email").getAttribute("aria-invalid")).toBe("true");
    expect(button("Accept").disabled).toBe(true);
  });

  it("submits typed content and leaves out empty optional fields", async () => {
    await renderPanel();
    await show(pendingOf("a", formParams));

    await type(input("name"), "Grace");
    await type(input("email"), "grace@example.com");
    await type(input("meetAt"), "2026-01-31T09:30:00Z");
    await type(input("age"), "36");
    await click(button("Large", field("size")));
    await click(button("Beta", field("tier")));
    await choose(field("country").querySelector("select")!, "de");
    await click(button("x", field("tags")));
    expect(field("tags").textContent).toContain("1 of 3 selected");
    expect(button("Accept").disabled).toBe(false);

    await click(button("Accept"));

    expect(api.respondElicitation).toHaveBeenCalledExactlyOnceWith({
      id: "a",
      action: "accept",
      content: {
        name: "Grace",
        email: "grace@example.com",
        meetAt: "2026-01-31T09:30:00Z",
        age: 36,
        subscribe: true,
        size: "l",
        tier: "b",
        country: "de",
        tags: ["x"],
        langs: ["en"],
      },
    });
    expect(panel()).toBeNull();
    expect(useActivityStore.getState().entries[0]).toMatchObject({
      kind: "elicitation",
      serverName: "server",
      target: "form: Tell us about **you**",
      outcome: "ok",
    });
  });

  it("clears optional toggles and pills when clicked again", async () => {
    await renderPanel();
    await show(pendingOf("a", formParams));

    await click(button("true", field("subscribe")));
    expect(button("true", field("subscribe")).getAttribute("aria-pressed")).toBe("false");
    await click(button("red", field("color")));
    expect(button("red", field("color")).getAttribute("aria-checked")).toBe("true");
    await click(button("red", field("color")));
    expect(button("red", field("color")).getAttribute("aria-checked")).toBe("false");
  });

  it("accepts with Ctrl+Enter once the form is valid", async () => {
    await renderPanel();
    await show(pendingOf("a", formParams));
    await type(input("email"), "ada@example.com");
    await type(input("age"), "40");
    await click(button("y", field("tags")));

    input("age").focus();
    await pressKey("Enter", { ctrlKey: true });

    expect(api.respondElicitation).toHaveBeenCalledExactlyOnceWith({
      id: "a",
      action: "accept",
      content: { name: "Ada", email: "ada@example.com", age: 40, subscribe: true, tags: ["y"], langs: ["en"] },
    });
  });

  it("reveals every error when Ctrl+Enter is pressed on an invalid form", async () => {
    await renderPanel();
    await show(pendingOf("a", formParams));
    input("name").focus();
    await pressKey("Enter", { metaKey: true });

    expect(api.respondElicitation).not.toHaveBeenCalled();
    expect(field("email").textContent).toContain("This field is required");
    expect(field("age").textContent).toContain("This field is required");
  });

  it("previews the response in the JSON inspector", async () => {
    await renderPanel();
    await show(pendingOf("a", formParams));
    await click(button("Inspect JSON"));
    expect(panel()?.textContent).toContain("elicitation/create params");
    expect(panel()?.textContent).toContain("Response preview");
    expect(panel()?.textContent).toContain('"accept"');
  });

  it("declines and cancels without content, leaving Escape unbound", async () => {
    await renderPanel();
    await show(pendingOf("a", formParams), pendingOf("b", formParams));

    input("name").focus();
    await pressKey("Escape");
    expect(api.respondElicitation).not.toHaveBeenCalled();

    await click(button("Decline"));
    expect(api.respondElicitation).toHaveBeenLastCalledWith({ id: "a", action: "decline" });

    await click(button("Cancel"));
    expect(api.respondElicitation).toHaveBeenLastCalledWith({ id: "b", action: "cancel" });
    expect(panel()).toBeNull();
  });

  it("shows server-side errors and keeps the panel open", async () => {
    vi.mocked(api.respondElicitation).mockRejectedValueOnce(
      new ApiError(400, "email: Enter a valid email address", { code: "BAD_REQUEST" }),
    );
    await renderPanel();
    await show(pendingOf("a", formParams));
    await click(button("Decline"));

    expect(panel()?.querySelector('[role="alert"]')?.textContent).toContain("email: Enter a valid email address");
    expect(panel()).not.toBeNull();
  });

  it("preserves typed form drafts across panel unmount and remount while pending", async () => {
    await renderPanel();
    await show(pendingOf("a", formParams));
    await type(input("name"), "Grace");

    await act(async () => root.render(<></>));
    await renderPanel();

    expect(panel()).not.toBeNull();
    expect(input("name").value).toBe("Grace");
    expect(container.textContent).not.toContain("Input requested");
  });

  it("offers to switch servers when another server is waiting", async () => {
    const onSelectServer = await renderPanel();
    await show(pendingOf("z", formParams, "other"));

    expect(panel()).toBeNull();
    expect(container.textContent).toContain("other is waiting for your input");
    await click(button("Switch to other", container));
    expect(onSelectServer).toHaveBeenCalledExactlyOnceWith(other);
  });

  it("lets the user cancel an orphaned elicitation from an unknown server in the banner", async () => {
    await renderPanel();
    await show(pendingOf("orphan-1", formParams, "removed-server"));

    expect(panel()).toBeNull();
    expect(container.textContent).toContain("removed-server is waiting for your input");
    await click(button("Cancel", container));
    expect(api.respondElicitation).toHaveBeenCalledExactlyOnceWith({ id: "orphan-1", action: "cancel" });
  });
});

describe("queued elicitations", () => {
  it("switches between pending requests and answers them one by one", async () => {
    const second: ElicitationRequestParams = { ...urlParams, message: "Second request" };
    await renderPanel();
    await show(pendingOf("a", formParams), pendingOf("b", second));

    expect(panel()?.textContent).toContain("1 of 2");
    expect(panel()?.textContent).toContain("Tell us about");
    await click(panel()!.querySelector<HTMLElement>('[aria-label="Next elicitation"]')!);
    expect(panel()?.textContent).toContain("2 of 2");
    expect(panel()?.textContent).toContain("Second request");

    await click(button("Decline"));
    expect(api.respondElicitation).toHaveBeenLastCalledWith({ id: "b", action: "decline" });
    expect(panel()?.textContent).toContain("Tell us about");
    expect(panel()?.querySelector('[aria-label="Next elicitation"]')).toBeNull();

    await click(button("Cancel"));
    expect(api.respondElicitation).toHaveBeenLastCalledWith({ id: "a", action: "cancel" });
    expect(panel()).toBeNull();
  });
});

describe("URL elicitation", () => {
  it("shows the origin and opens the URL only on request", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await renderPanel();
    await show(pendingOf("u", urlParams));

    expect(panel()?.textContent).toContain("URL elicitation");
    expect(panel()?.querySelector('[data-testid="elicitation-origin"]')?.textContent).toBe("https://auth.example.com");
    expect(panel()?.textContent).toContain("https://auth.example.com/start?state=abc");
    expect(panel()?.textContent).toContain("id el-1");
    expect(open).not.toHaveBeenCalled();

    await click(button("Open URL"));
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "https://auth.example.com/start?state=abc",
      "_blank",
      "noopener,noreferrer",
    );
    expect(panel()?.textContent).toContain("opened, waiting for the server");
  });

  it("renders URL elicitation messages as plain text rather than clickable markdown links", async () => {
    await renderPanel();
    await show(pendingOf("u", { ...urlParams, message: "Continue at [accounts.google.com](https://evil.example)" }));

    expect(panel()?.querySelector("a")).toBeNull();
    expect(panel()?.textContent).toContain("Continue at [accounts.google.com](https://evil.example)");
  });

  it("blocks non-http URLs", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await renderPanel();
    await show(pendingOf("u", { ...urlParams, url: "javascript:alert(1)" }));

    expect(button("Open URL").disabled).toBe(true);
    expect(panel()?.querySelector('[role="alert"]')?.textContent).toContain("Only http: and https: URLs can be opened");
    await click(button("Open URL"));
    expect(open).not.toHaveBeenCalled();
  });

  it("marks the request completed when the server sends a completion notification", async () => {
    await renderPanel();
    await show(pendingOf("u", urlParams));
    expect(panel()?.textContent).not.toContain("Completed");

    await act(async () =>
      useElicitationStore.setState({
        completions: [{ serverName: "server", elicitationId: "el-1", completedAt: "2026-11-25T10:01:00.000Z" }],
      }),
    );
    expect(panel()?.textContent).toContain("Completed");
  });

  it.each(["accept", "decline", "cancel"] as const)("sends %s without content", async (action) => {
    await renderPanel();
    await show(pendingOf("u", urlParams));
    await click(button(action[0]!.toUpperCase() + action.slice(1)));
    expect(api.respondElicitation).toHaveBeenCalledExactlyOnceWith({ id: "u", action });
  });
});

describe("URL elicitation required errors", () => {
  it("renders the required links with live completion and a retry button", async () => {
    const onRetry = vi.fn();
    vi.spyOn(window, "open").mockReturnValue(null);
    await act(async () =>
      root.render(
        <ErrorMessage
          error="URL elicitation required"
          urlElicitations={[
            { mode: "url", message: "Authorize [GitHub](https://evil.example)", url: "https://github.example/oauth", elicitationId: "gh" },
            { mode: "url", message: "Bad link", url: "javascript:void(0)" },
          ]}
          onRetry={onRetry}
        />,
      ),
    );

    const cards = container.querySelectorAll('[data-testid="url-elicitation-card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector("a")).toBeNull();
    expect(cards[0]!.textContent).toContain("Authorize [GitHub](https://evil.example)");
    expect(cards[0]!.querySelector('[data-testid="elicitation-origin"]')?.textContent).toBe("https://github.example");
    expect(button("Open URL", cards[0]!).disabled).toBe(false);
    expect(button("Open URL", cards[1]!).disabled).toBe(true);
    expect(cards[0]!.textContent).not.toContain("Completed");

    await act(async () =>
      useElicitationStore.setState({
        completions: [{ serverName: "server", elicitationId: "gh", completedAt: "2026-11-25T10:01:00.000Z" }],
      }),
    );
    expect(cards[0]!.textContent).toContain("Completed");

    await click(button("Retry", container));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
