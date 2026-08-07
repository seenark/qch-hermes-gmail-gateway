export function buildServerPath(path: string, serverUrl?: string): string {
  return `${serverUrl ?? ""}${path}`;
}
