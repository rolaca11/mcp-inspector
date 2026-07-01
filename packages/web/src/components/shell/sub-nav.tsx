import { AppWindow } from "lucide-react";

import type { NavKey } from "@/components/nav-tabs";
import { useConnectionStore } from "@/stores/connection-store";
import { useSelectionStore } from "@/stores/selection-store";
import { toolUiResourceUri } from "@/lib/mcp-apps";
import {
  buildResourceItems,
  resourceItemIsUi,
  resourceItemKey,
  resourceItemLabel,
} from "@/lib/capability-lists";
import { cn } from "@/lib/utils";

/** A selectable child of a capability nav row (a single resource or tool). */
export interface NavSubItem {
  key: string;
  label: string;
  isUi: boolean;
  isActive: boolean;
  onSelect: () => void;
}

/**
 * Builds the selectable sub-items for the capability nav rows that have them
 * (Resources, Tools). Selecting one writes to the selection store, which the
 * matching page reads to render its detail panel — so a nav row owns its list
 * and the page stays a pure detail view. Keyed by nav key so callers can look
 * up a row's children directly.
 */
export function useCapabilitySubItems(
  serverName: string,
): Partial<Record<NavKey, NavSubItem[]>> {
  const { data } = useConnectionStore();
  const selectionStore = useSelectionStore();

  const resourceItems = buildResourceItems(
    data?.resources ?? [],
    data?.resourceTemplates ?? [],
  );
  const storedResource = selectionStore.get(serverName, "resources-selected");
  const firstResource = resourceItems[0];
  const selectedResource =
    storedResource &&
    resourceItems.some((i) => resourceItemKey(i) === storedResource)
      ? storedResource
      : firstResource
        ? resourceItemKey(firstResource)
        : null;
  const resources: NavSubItem[] = resourceItems.map((item) => {
    const key = resourceItemKey(item);
    return {
      key,
      label: resourceItemLabel(item),
      isUi: resourceItemIsUi(item),
      isActive: key === selectedResource,
      onSelect: () =>
        selectionStore.set(serverName, "resources-selected", key),
    };
  });

  const toolList = data?.tools ?? [];
  const storedTool = selectionStore.get(serverName, "tools");
  const firstTool = toolList[0];
  const selectedTool =
    storedTool && toolList.some((t) => t.name === storedTool)
      ? storedTool
      : (firstTool?.name ?? null);
  const tools: NavSubItem[] = toolList.map((t) => ({
    key: t.name,
    label: t.title ?? t.name,
    isUi: toolUiResourceUri(t._meta) !== undefined,
    isActive: t.name === selectedTool,
    onSelect: () => selectionStore.set(serverName, "tools", t.name),
  }));

  return { resources, tools };
}

/**
 * Renders a capability nav row's sub-items — either nested under the row in the
 * sidebar, or inline on a page (the small-screen fallback where the sidebar is
 * hidden). Purely presentational: it just maps whatever array it's given.
 */
export function SubNav({
  items,
  variant,
}: {
  items: NavSubItem[];
  variant: "sidebar" | "page";
}) {
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 overflow-y-auto",
        variant === "sidebar"
          ? "mb-1 ml-3.5 mt-0.5 max-h-[45vh] border-l border-sidebar-border pl-2"
          : "mb-2 max-h-[40vh]",
      )}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={item.onSelect}
          aria-current={item.isActive ? "true" : undefined}
          className={cn(
            "flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pl-2 pr-1.5 text-left text-[13px] transition-colors",
            item.isActive
              ? "bg-sidebar-accent/40 text-foreground/90"
              : "text-muted-foreground/60 hover:bg-sidebar-accent/25 hover:text-foreground",
          )}
        >
          <span className="truncate">{item.label}</span>
          {item.isUi && (
            <AppWindow
              className="ml-auto size-3 shrink-0 text-info"
              aria-label="UI resource"
            />
          )}
        </button>
      ))}
    </div>
  );
}
