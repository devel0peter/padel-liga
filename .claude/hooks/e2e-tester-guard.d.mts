export function checkToolCall(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  cwd: string,
  roots?: (string | undefined)[],
): { allow: true } | { allow: false; reason: string };
