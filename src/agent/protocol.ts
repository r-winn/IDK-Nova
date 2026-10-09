import type { AgentToolCall } from "../lib/ai";

export type ToolEffect = "read" | "write" | "external";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type PermissionScope = "filesystem" | "terminal" | "browser" | "computer" | "user-input";
export type TaskState = "created" | "planning" | "waiting_permission" | "running" | "waiting_user" | "paused" | "interrupted" | "failed" | "completed" | "cancelled";

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

export function validateArguments(value: unknown, schema: Record<string, any>, path = 'arguments'): void {
  const fail = (detail: string): never => { throw new Error(`Invalid ${path}: ${detail}`); };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object');
    const object = value as Record<string, unknown>;
    for (const name of schema.required || []) if (!(name in object)) fail(`missing ${name}`);
    for (const [name, item] of Object.entries(object)) {
      const property = schema.properties?.[name];
      if (!property && schema.additionalProperties === false) fail(`unknown property ${name}`);
      if (property) validateArguments(item, property, `${path}.${name}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('expected an array');
    const items = value as unknown[];
    if (schema.minItems !== undefined && items.length < schema.minItems) fail('too few items');
    if (schema.maxItems !== undefined && items.length > schema.maxItems) fail('too many items');
    if (schema.items) items.forEach((item, index) => validateArguments(item, schema.items, `${path}[${index}]`));
  } else if (schema.type === 'string' && typeof value !== 'string') fail('expected text');
  else if (schema.type === 'boolean' && typeof value !== 'boolean') fail('expected a boolean');
  else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) fail('expected a valid number');
    if (schema.minimum !== undefined && (value as number) < schema.minimum) fail('below minimum');
    if (schema.maximum !== undefined && (value as number) > schema.maximum) fail('above maximum');
  }
  if (schema.enum && !schema.enum.includes(value)) fail('not an allowed value');
}

export const parseToolCall = (call: AgentToolCall, definition: NovaToolDefinition, workingDirectory: string): NovaToolCall => {
  let args: Record<string, unknown>;
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    args = parsed;
  } catch {
    throw new Error("Tool arguments are not valid JSON");
  }
  validateArguments(args, definition.function.parameters);
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
