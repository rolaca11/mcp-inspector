import * as React from "react";

interface SubmitShortcutOptions {
  /** Whether submitting is currently allowed. Defaults to true. */
  canSubmit?: boolean;
}

/**
 * Returns an `onKeyDown` handler that submits a request form from the keyboard:
 * Enter (in a text `<input>` or `<textarea>`) sends the request, while
 * Shift+Enter inserts a newline.
 *
 * Attach it to the element wrapping the form fields (and submit button). Other
 * elements — the JSON editor, buttons, selects — keep their own Enter behavior,
 * and presses already handled by a child (e.g. picking an autocomplete
 * suggestion, which calls `preventDefault`) are skipped.
 */
export function useSubmitShortcut(
  onSubmit: () => void,
  { canSubmit = true }: SubmitShortcutOptions = {},
) {
  return React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Enter") return;
      // Shift+Enter inserts a newline instead of submitting.
      if (e.shiftKey) return;
      // A child handler (e.g. autocomplete selection) already consumed this.
      if (e.defaultPrevented) return;
      // Mid-IME-composition Enter commits the composition, not the form.
      if (e.nativeEvent.isComposing) return;

      const tag = (e.target as HTMLElement).tagName;
      // The JSON editor (contenteditable), buttons, selects, etc. keep their
      // own Enter behavior — only plain form fields submit.
      if (tag !== "INPUT" && tag !== "TEXTAREA") return;

      e.preventDefault();
      if (canSubmit) onSubmit();
    },
    [onSubmit, canSubmit],
  );
}
