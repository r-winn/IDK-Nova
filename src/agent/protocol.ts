import type { AgentToolCall } from "../lib/ai";

export type ToolEffect = "read" | "write" | "external";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PermissionScope = "filesystem" | "terminal" | "browser" | "computer" | "user-input";
export type TaskState = "created" | "planning" | "waiting_permission" | "running" | "waiting_user" | "paused" | "failed" | "completed" | "cancelled";

export type NovaToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  nova: {
    effect: ToolEffect;
    risk: RiskLevel;
    scope: PermissionScope;
    label: string;
  };
};

export type NovaToolCall = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  workingDirectory: string;
  effect: ToolEffect;
  riskLevel: RiskLevel;
  permissionScope: PermissionScope;
  timeoutMs: number;
};

export type NovaToolResult = {
  callId: string;
  status: "success" | "error" | "denied" | "cancelled";
  stdout?: string;
  stderr?: string;
  structuredData?: unknown;
  attachments?: string[];
  screenshots?: string[];
  changedFiles?: string[];
  durationMs: number;
  __novaImage?: string;
};

export type TaskEvent = {
  id: string;
  taskId: string;
  at: number;
  kind: "task" | "plan" | "tool" | "permission" | "result" | "error";
  state: TaskState;
  label: string;
  callId?: string;
  toolName?: string;
  detail?: string;
};

export type AgentTask = {
  id: string;
  chatId: number;
  workspaceId: string;
  state: TaskState;
  goal: string;
  createdAt: number;
  updatedAt: number;
  events: TaskEvent[];
};

export const parseToolCall = (call: AgentToolCall, definition: NovaToolDefinition, workingDirectory: string): NovaToolCall => {
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    args = parsed;
  } catch {
    throw new Error("Tool arguments are not valid JSON");
  }
  return {
    id: call.id,
    toolName: definition.function.name,
    arguments: args,
    workingDirectory,
    effect: definition.nova.effect,
    riskLevel: definition.nova.risk,
    permissionScope: definition.nova.scope,
    timeoutMs: definition.nova.scope === "terminal" ? 120_000 : 30_000,
  };
};
