import * as React from "react";

const DefaultCollapsedCtx = React.createContext(false);

interface JsonTreeProps {
  data: unknown;
  defaultCollapsed?: boolean;
}

export function JsonTree({ data, defaultCollapsed = false }: JsonTreeProps) {
  return (
    <DefaultCollapsedCtx.Provider value={defaultCollapsed}>
      <JsonNode value={data} depth={0} />
    </DefaultCollapsedCtx.Provider>
  );
}

const INDENT = "  ";

function pad(depth: number) {
  return INDENT.repeat(depth);
}

function JsonNode({ value, depth }: { value: unknown; depth: number }) {
  if (value === null)
    return <span className="text-muted-foreground">null</span>;
  switch (typeof value) {
    case "boolean":
      return <span className="text-warning">{String(value)}</span>;
    case "number":
      return <span className="text-warning">{String(value)}</span>;
    case "string":
      return <span className="text-success">{JSON.stringify(value)}</span>;
    case "object":
      return Array.isArray(value) ? (
        <JsonArray items={value} depth={depth} />
      ) : (
        <JsonObject obj={value as Record<string, unknown>} depth={depth} />
      );
    default:
      return <>{String(value)}</>;
  }
}

function ToggleBtn({
  collapsed,
  onToggle,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      className="cursor-pointer rounded-sm transition-colors hover:bg-muted/40"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <span className="text-muted-foreground/50 select-none">
        {collapsed ? "▸ " : "▾ "}
      </span>
      {children}
    </span>
  );
}

function JsonObject({
  obj,
  depth,
}: {
  obj: Record<string, unknown>;
  depth: number;
}) {
  const defaultCollapsed = React.useContext(DefaultCollapsedCtx);
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const entries = Object.entries(obj);

  if (entries.length === 0)
    return <span className="text-muted-foreground">{"{}"}</span>;

  if (collapsed) {
    return (
      <ToggleBtn collapsed onToggle={() => setCollapsed(false)}>
        <span className="text-muted-foreground">{"{"}</span>
        <span className="text-muted-foreground/50 italic">{" … "}</span>
        <span className="text-muted-foreground">{"}"}</span>
        <span className="text-muted-foreground/40 select-none text-[0.85em]">
          {" "}
          {entries.length}
        </span>
      </ToggleBtn>
    );
  }

  return (
    <>
      <ToggleBtn collapsed={false} onToggle={() => setCollapsed(true)}>
        <span className="text-muted-foreground">{"{"}</span>
      </ToggleBtn>
      {"\n"}
      {entries.map(([key, val], i) => (
        <React.Fragment key={key}>
          {pad(depth + 1)}
          <span className="text-info">{JSON.stringify(key)}</span>
          <span className="text-muted-foreground">{": "}</span>
          <JsonNode value={val} depth={depth + 1} />
          {i < entries.length - 1 && (
            <span className="text-muted-foreground">,</span>
          )}
          {"\n"}
        </React.Fragment>
      ))}
      {pad(depth)}
      <span className="text-muted-foreground">{"}"}</span>
    </>
  );
}

function JsonArray({
  items,
  depth,
}: {
  items: unknown[];
  depth: number;
}) {
  const defaultCollapsed = React.useContext(DefaultCollapsedCtx);
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  if (items.length === 0)
    return <span className="text-muted-foreground">{"[]"}</span>;

  if (collapsed) {
    return (
      <ToggleBtn collapsed onToggle={() => setCollapsed(false)}>
        <span className="text-muted-foreground">{"["}</span>
        <span className="text-muted-foreground/50 italic">{" … "}</span>
        <span className="text-muted-foreground">{"]"}</span>
        <span className="text-muted-foreground/40 select-none text-[0.85em]">
          {" "}
          {items.length}
        </span>
      </ToggleBtn>
    );
  }

  return (
    <>
      <ToggleBtn collapsed={false} onToggle={() => setCollapsed(true)}>
        <span className="text-muted-foreground">{"["}</span>
      </ToggleBtn>
      {"\n"}
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {pad(depth + 1)}
          <JsonNode value={item} depth={depth + 1} />
          {i < items.length - 1 && (
            <span className="text-muted-foreground">,</span>
          )}
          {"\n"}
        </React.Fragment>
      ))}
      {pad(depth)}
      <span className="text-muted-foreground">{"]"}</span>
    </>
  );
}
