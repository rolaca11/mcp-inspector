import * as React from "react";
import { Check, Copy } from "lucide-react";

import { jsonValueText } from "@/lib/json-text";

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

interface RowProps {
  depth: number;
  prefix?: React.ReactNode;
  copyLabel?: string;
}

function JsonNode({
  value,
  ...row
}: RowProps & { value: unknown }) {
  if (value !== null && typeof value === "object") {
    return Array.isArray(value) ? (
      <JsonArray items={value} {...row} />
    ) : (
      <JsonObject obj={value as Record<string, unknown>} {...row} />
    );
  }
  return (
    <RowHead value={value} {...row}>
      <JsonScalar value={value} />
    </RowHead>
  );
}

function JsonScalar({ value }: { value: unknown }) {
  if (value === null)
    return <span className="text-muted-foreground">null</span>;
  switch (typeof value) {
    case "boolean":
    case "number":
      return <span className="text-warning">{String(value)}</span>;
    case "string":
      return <span className="text-success">{JSON.stringify(value)}</span>;
    default:
      return <>{String(value)}</>;
  }
}

function RowHead({
  value,
  prefix,
  copyLabel,
  children,
}: Omit<RowProps, "depth"> & { value: unknown; children: React.ReactNode }) {
  return (
    <span className="group/line">
      {prefix}
      {children}
      {copyLabel != null && <CopyValueButton value={value} label={copyLabel} />}
    </span>
  );
}

function CopyValueButton({ value, label }: { value: unknown; label: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(jsonValueText(value)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="ml-1.5 inline-flex rounded p-0.5 align-middle text-muted-foreground/60 opacity-0 transition-all select-none hover:bg-muted/70 hover:text-foreground focus-visible:opacity-100 group-hover/line:opacity-100 pointer-coarse:opacity-100 cursor-pointer"
      aria-label={`Copy ${label}`}
      title="Copy value"
    >
      {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
    </button>
  );
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
      {children}
      <span className="text-muted-foreground/50 select-none">
        {collapsed ? " ▸" : " ▾"}
      </span>
    </span>
  );
}

function JsonObject({
  obj,
  ...row
}: RowProps & { obj: Record<string, unknown> }) {
  const { depth } = row;
  const defaultCollapsed = React.useContext(DefaultCollapsedCtx);
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const entries = Object.entries(obj);

  if (entries.length === 0)
    return (
      <RowHead value={obj} {...row}>
        <span className="text-muted-foreground">{"{}"}</span>
      </RowHead>
    );

  if (collapsed) {
    return (
      <RowHead value={obj} {...row}>
        <ToggleBtn collapsed onToggle={() => setCollapsed(false)}>
          <span className="text-muted-foreground">{"{"}</span>
          <span className="text-muted-foreground/50 italic">{" … "}</span>
          <span className="text-muted-foreground">{"}"}</span>
          <span className="text-muted-foreground/40 select-none text-[0.85em]">
            {" "}
            {entries.length}
          </span>
        </ToggleBtn>
      </RowHead>
    );
  }

  return (
    <>
      <RowHead value={obj} {...row}>
        <ToggleBtn collapsed={false} onToggle={() => setCollapsed(true)}>
          <span className="text-muted-foreground">{"{"}</span>
        </ToggleBtn>
      </RowHead>
      {"\n"}
      {entries.map(([key, val], i) => (
        <React.Fragment key={key}>
          <JsonNode
            value={val}
            depth={depth + 1}
            copyLabel={JSON.stringify(key)}
            prefix={
              <>
                {pad(depth + 1)}
                <span className="text-info">{JSON.stringify(key)}</span>
                <span className="text-muted-foreground">{": "}</span>
              </>
            }
          />
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
  ...row
}: RowProps & { items: unknown[] }) {
  const { depth } = row;
  const defaultCollapsed = React.useContext(DefaultCollapsedCtx);
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  if (items.length === 0)
    return (
      <RowHead value={items} {...row}>
        <span className="text-muted-foreground">{"[]"}</span>
      </RowHead>
    );

  if (collapsed) {
    return (
      <RowHead value={items} {...row}>
        <ToggleBtn collapsed onToggle={() => setCollapsed(false)}>
          <span className="text-muted-foreground">{"["}</span>
          <span className="text-muted-foreground/50 italic">{" … "}</span>
          <span className="text-muted-foreground">{"]"}</span>
          <span className="text-muted-foreground/40 select-none text-[0.85em]">
            {" "}
            {items.length}
          </span>
        </ToggleBtn>
      </RowHead>
    );
  }

  return (
    <>
      <RowHead value={items} {...row}>
        <ToggleBtn collapsed={false} onToggle={() => setCollapsed(true)}>
          <span className="text-muted-foreground">{"["}</span>
        </ToggleBtn>
      </RowHead>
      {"\n"}
      {items.map((item, i) => (
        <React.Fragment key={i}>
          <JsonNode
            value={item}
            depth={depth + 1}
            copyLabel={`[${i}]`}
            prefix={pad(depth + 1)}
          />
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
