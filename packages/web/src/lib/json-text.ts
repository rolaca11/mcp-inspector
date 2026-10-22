export function formatJsonText(text: string, indent = 2): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, indent);
  } catch {
    return null;
  }
}

export function minifyJsonText(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return null;
  }
}

export function jsonValueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
