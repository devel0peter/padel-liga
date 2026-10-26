#!/usr/bin/env node
// PreToolUse hook of the e2e-tester agent (#103): reads the tool call from
// stdin, asks e2e-tester-guard.mjs, and exits 2 (blocked, the reason goes back
// to the agent) unless it is allowed. It fails closed: any error, and a missing
// hook file (the agent file runs it as `node <this file> || exit 2`), blocks.
import { readFileSync } from "node:fs";

try {
  const { checkToolCall } = await import("./e2e-tester-guard.mjs");
  const input = JSON.parse(readFileSync(0, "utf8"));
  const roots = [process.env.CLAUDE_PROJECT_DIR, input.cwd];
  const result = checkToolCall(input.tool_name, input.tool_input, input.cwd, roots);
  if (!result.allow) {
    console.error(`Blocked: ${result.reason}`);
    process.exit(2);
  }
} catch (error) {
  console.error(`e2e-tester guard: blocked, it could not check the call (${error instanceof Error ? error.message : error}).`);
  process.exit(2);
}
