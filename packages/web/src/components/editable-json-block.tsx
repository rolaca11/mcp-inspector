import * as React from "react";
import { Check, ClipboardPaste, Copy, Minimize2 } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import json from "highlight.js/lib/languages/json";

import { cn } from "@/lib/utils";

const lowlight = createLowlight();
lowlight.register({ json });

const JsonDocument = Document.extend({ content: "codeBlock" });

function makeCodeBlockContent(text: string) {
  return {
    type: "doc" as const,
    content: [{
      type: "codeBlock" as const,
      attrs: { language: "json" },
      content: text ? [{ type: "text" as const, text }] : [],
    }],
  };
}

interface EditableJsonBlockProps {
  value: string;
  onChange: (text: string) => void;
  onBlur?: () => void;
  error?: string | null;
  label?: string;
  className?: string;
  pasteable?: boolean;
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
  const [copied, setCopied] = React.useState(false);
  const [copiedMinified, setCopiedMinified] = React.useState(false);
  const [pasted, setPasted] = React.useState(false);
  const valueRef = React.useRef(value);
  valueRef.current = value;

  const minifiedJson = React.useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return null;
    }
  }, [value]);

  const onCopy = React.useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [value]);

  const onCopyMinified = React.useCallback(() => {
    if (minifiedJson == null) return;
    void navigator.clipboard.writeText(minifiedJson).then(() => {
      setCopiedMinified(true);
      setTimeout(() => setCopiedMinified(false), 1200);
    });
  }, [minifiedJson]);

  const handleBlur = React.useCallback(() => {
    onBlur?.();
  }, [onBlur]);

  const editor = useEditor({
    extensions: [
      JsonDocument,
      Text,
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: "json",
        exitOnTripleEnter: false,
        exitOnArrowDown: false,
      }),
    ],
    content: makeCodeBlockContent(value),
    onUpdate: ({ editor }) => {
      onChange(editor.state.doc.textContent);
    },
    onBlur: ({ editor }) => {
      if (editor.state.doc.textContent !== valueRef.current) {
        editor.commands.setContent(makeCodeBlockContent(valueRef.current));
      }
      handleBlur();
    },
  }, [onChange, handleBlur]);

  React.useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isFocused) return;
    if (editor.state.doc.textContent === value) return;

    editor.commands.setContent(makeCodeBlockContent(value));
  }, [value, editor]);

  const onPaste = React.useCallback(() => {
    if (!navigator.clipboard?.readText) return;
    void navigator.clipboard.readText().then((text) => {
      onChange(text);
      editor?.commands.setContent(makeCodeBlockContent(text));
      editor?.commands.focus("end");
      setPasted(true);
      setTimeout(() => setPasted(false), 1200);
    }).catch(() => {});
  }, [editor, onChange]);

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
            <button
              type="button"
              onClick={onPaste}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
              aria-label="Paste from clipboard"
            >
              {pasted ? (
                <>
                  <Check className="size-3 text-success" />
                  <span>pasted</span>
                </>
              ) : (
                <>
                  <ClipboardPaste className="size-3" />
                  <span>paste</span>
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <Check className="size-3 text-success" />
                <span>copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3" />
                <span>copy</span>
              </>
            )}
          </button>
          {minifiedJson != null && (
            <button
              type="button"
              onClick={onCopyMinified}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-muted/70 hover:text-foreground cursor-pointer"
              aria-label="Copy minified JSON"
            >
              {copiedMinified ? (
                <>
                  <Check className="size-3 text-success" />
                  <span>copied</span>
                </>
              ) : (
                <>
                  <Minimize2 className="size-3" />
                  <span>copy minified</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
      <EditorContent editor={editor} className="json-editor-content" />
    </div>
  );
}
