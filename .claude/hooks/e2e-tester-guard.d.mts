export function checkToolCall(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  cwd?: string,
): { allow: true } | { allow: false; reason: string };
