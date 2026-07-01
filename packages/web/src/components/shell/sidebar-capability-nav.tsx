import { AppWindow } from "lucide-react";

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

/**
 * Where the list is rendered. `sidebar` indents under the active nav row;
 * `page` is the in-content fallback shown on small screens, where the sidebar
 * is hidden.
 */
type Variant = "sidebar" | "page";

/**
 * The Resources / Tools sub-navigation rendered inside the sidebar underneath
 * the active capability's nav row. Selecting an entry writes to the selection
 * store, which the corresponding page reads to render its detail panel — so the
 * list lives once, in the sidebar, and is only mounted while its page is active.
 */
export function ResourcesSubNav({
  serverName,
  variant = "sidebar",
}: {
  serverName: string;
  variant?: Variant;
}) {
  const { data } = useConnectionStore();
  const selectionStore = useSelectionStore();

  const items = buildResourceItems(
    data?.resources ?? [],
    data?.resourceTemplates ?? [],
  );

  const storedKey = selectionStore.get(serverName, "resources-selected");
  const selectedKey =
    storedKey && items.some((i) => resourceItemKey(i) === storedKey)
      ? storedKey
      : items[0]
        ? resourceItemKey(items[0])
        : null;

  if (items.length === 0) return null;

  return (
    <SubNav variant={variant}>
      {items.map((item) => {
        const key = resourceItemKey(item);
        return (
          <SubNavItem
            key={key}
            label={resourceItemLabel(item)}
            isActive={key === selectedKey}
            isUi={resourceItemIsUi(item)}
            onSelect={() =>
              selectionStore.set(serverName, "resources-selected", key)
            }
          />
        );
      })}
    </SubNav>
  );
}

export function ToolsSubNav({
  serverName,
  variant = "sidebar",
}: {
  serverName: string;
  variant?: Variant;
}) {
  const { data } = useConnectionStore();
  const selectionStore = useSelectionStore();

  const tools = data?.tools ?? [];

  const storedName = selectionStore.get(serverName, "tools");
  const selectedName =
    storedName && tools.some((t) => t.name === storedName)
      ? storedName
      : (tools[0]?.name ?? null);

  if (tools.length === 0) return null;

  return (
    <SubNav variant={variant}>
      {tools.map((t) => (
        <SubNavItem
          key={t.name}
          label={t.title ?? t.name}
          isActive={t.name === selectedName}
          isUi={toolUiResourceUri(t._meta) !== undefined}
          onSelect={() => selectionStore.set(serverName, "tools", t.name)}
        />
      ))}
    </SubNav>
  );
}

/* ------------------------------------------------------------------ */

function SubNav({
  variant,
  children,
}: {
  variant: Variant;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 overflow-y-auto",
        variant === "sidebar"
          ? "mb-1 ml-3.5 mt-0.5 max-h-[45vh] border-l border-sidebar-border pl-2"
          : "mb-2 max-h-[40vh]",
      )}
    >
      {children}
    </div>
  );
}

function SubNavItem({
  label,
  isActive,
  isUi,
  onSelect,
}: {
  label: string;
  isActive: boolean;
  isUi: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pl-2 pr-1.5 text-left text-[13px] transition-colors",
        isActive
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      {isUi && (
        <AppWindow
          className="ml-auto size-3 shrink-0 text-info"
          aria-label="UI resource"
        />
      )}
    </button>
  );
}
