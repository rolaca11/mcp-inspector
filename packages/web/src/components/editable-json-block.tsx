import * as React from "react";
import { AlignLeft, Check, ClipboardPaste, Copy, Minimize2 } from "lucide-react";
import { Annotation, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type KeyBinding,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import { lintGutter, lintKeymap, linter, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";

import { cn } from "@/lib/utils";
import { formatJsonText, minifyJsonText } from "@/lib/json-text";

const jsonHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--info)" },
  { tag: tags.string, color: "var(--success)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--warning)" },
  { tag: [tags.punctuation, tags.separator, tags.brace, tags.squareBracket], color: "var(--muted-foreground)" },
  { tag: tags.invalid, color: "var(--destructive)" },
]);

const editorTheme = EditorView.theme({
  "&": {
    flex: "1",
    minHeight: "6rem",
    fontSize: "0.875rem",
    color: "oklch(0.985 0 0 / 0.9)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.625",
  },
  ".cm-content": {
    padding: "0.75rem 0",
    caretColor: "var(--foreground)",
  },
  ".cm-line": { padding: "0 1rem 0 0.5rem" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    opacity: "0.7",
    border: "none",
    paddingLeft: "0.5rem",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "2rem" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", opacity: "1" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--muted) 35%, transparent)" },
  ".cm-foldGutter .cm-gutterElement": { cursor: "pointer" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    border: "none",
    color: "var(--muted-foreground)",
    margin: "0 0.25rem",
    padding: "0 0.4rem",
    borderRadius: "0.25rem",
  },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--signature) 30%, transparent) !important",
  },
  ".cm-selectionMatch": { backgroundColor: "color-mix(in oklch, var(--signature) 18%, transparent)" },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--info) 25%, transparent)",
    outline: "1px solid color-mix(in oklch, var(--info) 50%, transparent)",
  },
  "&.cm-focused .cm-nonmatchingBracket": {
    backgroundColor: "color-mix(in oklch, var(--destructive) 25%, transparent)",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--destructive)",
    textUnderlineOffset: "3px",
  },
  ".cm-gutter-lint": { width: "0.9rem" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "0.375rem",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
  },
  ".cm-tooltip.cm-tooltip-lint": { padding: "0.25rem 0.5rem" },
  ".cm-diagnostic": { borderLeft: "none", padding: "0.125rem 0" },
  ".cm-diagnostic-error": { borderLeft: "2px solid var(--destructive)", paddingLeft: "0.5rem" },
  ".cm-panels": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.75rem",
  },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": { padding: "0.5rem 0.75rem" },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": {
    backgroundColor: "var(--input)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "0.25rem",
    padding: "0.125rem 0.375rem",
    margin: "0.125rem 0.25rem 0.125rem 0",
    fontFamily: "inherit",
    fontSize: "inherit",
  },
  ".cm-panel.cm-search button:hover": { backgroundColor: "var(--accent)" },
  ".cm-panel.cm-search label": { marginRight: "0.5rem" },
  ".cm-panel.cm-search [name=close]": {
    color: "var(--muted-foreground)",
    backgroundColor: "transparent",
    border: "none",
    fontSize: "1rem",
  },
});

function errorPosition(message: string, text: string): number {
  let match = message.match(/at position (\d+)/);
  if (match) return Math.min(Number(match[1]), text.length);
  match = message.match(/at line (\d+) column (\d+)/);
  if (match) {
    const lines = text.split("\n").slice(0, Number(match[1]) - 1);
    const lineStart = lines.reduce((sum, line) => sum + line.length + 1, 0);
    return Math.min(lineStart + Number(match[2]) - 1, text.length);
  }
  match = message.match(/"((?:[^"\\]|\\.)*)"\.\.\. is not valid JSON/);
  if (match) {
    const context = (match[1] ?? "").replace(/^\.\.\./, "");
    const index = text.indexOf(context);
    if (index >= 0) return index + Math.floor(context.length / 2);
  }
  return 0;
}

function jsonDiagnostics(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  let message: string;
  try {
    JSON.parse(text);
    return [];
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    message = error.message;
  }

  const diagnostics: Diagnostic[] = [];
  syntaxTree(view.state).iterate({
    enter: (node) => {
      if (!node.type.isError) return;
      diagnostics.push({
        from: node.from,
        to: Math.max(node.to, Math.min(node.from + 1, text.length)),
        severity: "error",
        message,
      });
    },
  });
  if (diagnostics.length > 0) return diagnostics;

  const from = errorPosition(message, text);
  return [{ from, to: Math.min(from + 1, text.length), severity: "error", message }];
}

const jsonLinter = linter(jsonDiagnostics, { delay: 300 });
const externalUpdate = Annotation.define<boolean>();

function formatDocument(view: EditorView): boolean {
  const current = view.state.doc.toString();
  const formatted = formatJsonText(current);
  if (formatted == null || formatted === current) return formatted != null;
  view.dispatch({
    changes: { from: 0, to: current.length, insert: formatted },
    userEvent: "format",
  });
  return true;
}

const formatKeymap: KeyBinding[] = [
  { key: "Shift-Alt-f", run: formatDocument, preventDefault: true },
];

interface EditableJsonBlockProps {
  value: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  error?: string | null;
  label?: string;
  className?: string;
  pasteable?: boolean;
}

interface ToolbarButtonProps {
  onClick: () => void;
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  done: boolean;
  doneLabel: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, ariaLabel, title, disabled, done, doneLabel, icon, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-inherit"
      aria-label={ariaLabel}
    >
      {done ? (
        <>
          <Check className="size-3 text-success" />
          <span>{doneLabel}</span>
        </>
      ) : (
        <>
          {icon}
          <span>{children}</span>
        </>
      )}
    </button>
  );
}

function useFlash(duration = 1200): [boolean, () => void] {
  const [active, setActive] = React.useState(false);
  const flash = React.useCallback(() => {
    setActive(true);
    setTimeout(() => setActive(false), duration);
  }, [duration]);
  return [active, flash];
}

export function EditableJsonBlock({
  value,
  onChange,
  onBlur,
  error,
  label = "JSON",
  className,
  pasteable = false,
}: EditableJsonBlockProps) {
  const [copied, flashCopied] = useFlash();
  const [copiedMinified, flashCopiedMinified] = useFlash();
  const [pasted, flashPasted] = useFlash();
  const [formatted, flashFormatted] = useFlash();

  const containerRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const valueRef = React.useRef(value);
  valueRef.current = value;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onBlurRef = React.useRef(onBlur);
  onBlurRef.current = onBlur;

  const minifiedJson = React.useMemo(() => minifyJsonText(value), [value]);
  const isValidJson = minifiedJson != null;

  React.useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          indentUnit.of("  "),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          json(),
          jsonLinter,
          lintGutter(),
          syntaxHighlighting(jsonHighlight),
          editorTheme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label }),
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...lintKeymap,
            ...formatKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || update.transactions.some((transaction) => transaction.annotation(externalUpdate))) return;
            onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: (_event, view) => {
              const current = view.state.doc.toString();
              if (current !== valueRef.current) {
                view.dispatch({
                  changes: { from: 0, to: current.length, insert: valueRef.current },
                  annotations: externalUpdate.of(true),
                });
              }
              onBlurRef.current?.();
            },
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [label]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view || view.hasFocus) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      annotations: externalUpdate.of(true),
    });
  }, [value]);

  const replaceDocument = React.useCallback((text: string) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
    });
    view.focus();
  }, []);

  const onCopy = React.useCallback(() => {
    void navigator.clipboard.writeText(value).then(flashCopied);
  }, [value, flashCopied]);

  const onCopyMinified = React.useCallback(() => {
    if (minifiedJson == null) return;
    void navigator.clipboard.writeText(minifiedJson).then(flashCopiedMinified);
  }, [minifiedJson, flashCopiedMinified]);

  const onPaste = React.useCallback(() => {
    if (!navigator.clipboard?.readText) return;
    void navigator.clipboard.readText().then((text) => {
      replaceDocument(text);
      flashPasted();
    }).catch(() => {});
  }, [replaceDocument, flashPasted]);

  const onFormat = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    if (formatDocument(view)) {
      view.focus();
      flashFormatted();
    }
  }, [flashFormatted]);

  return (
    <div
      className={cn(
        "json-editor group rounded-lg border overflow-hidden bg-card/40 flex flex-col",
        error ? "border-destructive/60" : "border-border/60",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground/80 font-mono">
        <span className="min-w-0 truncate">
          {label}
          {error && (
            <span className="text-destructive ml-2">· {error}</span>
          )}
        </span>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {pasteable && (
            <ToolbarButton
              onClick={onPaste}
              ariaLabel="Paste from clipboard"
              done={pasted}
              doneLabel="pasted"
              icon={<ClipboardPaste className="size-3" />}
            >
              paste
            </ToolbarButton>
          )}
          <ToolbarButton
            onClick={onFormat}
            ariaLabel="Format JSON"
            title="Format (Shift+Alt+F)"
            disabled={!isValidJson}
            done={formatted}
            doneLabel="formatted"
            icon={<AlignLeft className="size-3" />}
          >
            format
          </ToolbarButton>
          <ToolbarButton
            onClick={onCopy}
            ariaLabel="Copy code"
            done={copied}
            doneLabel="copied"
            icon={<Copy className="size-3" />}
          >
            copy
          </ToolbarButton>
          <ToolbarButton
            onClick={onCopyMinified}
            ariaLabel="Copy minified JSON"
            disabled={!isValidJson}
            done={copiedMinified}
            doneLabel="copied"
            icon={<Minimize2 className="size-3" />}
          >
            copy minified
          </ToolbarButton>
        </div>
      </div>
      <div ref={containerRef} className="json-editor-content" />
    </div>
  );
}
