import * as React from "react";
import { Check, Copy } from "lucide-react";
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
}

export function EditableJsonBlock({
  value,
  onChange,
  onBlur,
  error,
  label = "JSON",
  className,
}: EditableJsonBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const valueRef = React.useRef(value);
  valueRef.current = value;

  const onCopy = React.useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [value]);

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

  return (
    <div
      className={cn(
        "json-editor group rounded-lg border overflow-hidden bg-card/40 flex flex-col",
        error ? "border-destructive/60" : "border-border/60",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-xs text-muted-foreground/80 font-mono">
        <span className="truncate">
          {label}
          {error && (
            <span className="text-destructive ml-2">· {error}</span>
          )}
        </span>
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
      </div>
      <EditorContent editor={editor} className="json-editor-content" />
    </div>
  );
}
