export function appendConfigFiles(value: string, previous: string[]): string[] {
  const files = value
    .split(",")
    .map((file) => file.trim())
    .filter((file) => file.length > 0);
  return previous.concat(files);
}
