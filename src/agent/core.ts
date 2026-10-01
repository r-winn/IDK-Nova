import type { AgentToolCall } from "../lib/ai";
import type { WorkProject } from "../types";
import { approvalCopy, evaluateToolPolicy } from "./policy";
import { parseToolCall, type NovaToolCall, type NovaToolResult } from "./protocol";
import { toolDefinition } from "./catalog";
import { AgentTaskStore } from "./task-store";

type Approval = (copy: ReturnType<typeof approvalCopy>) => Promise<boolean>;

export class NovaAgentCore {
  readonly task: AgentTaskStore;

  constructor(
    chatId: number,
    private project: WorkProject,
    goal: string,
    private onStatus: (label: string) => void,
    private requestApproval: Approval,
  ) {
    this.task = new AgentTaskStore(chatId, project.id, goal);
    this.task.event("task", "planning", "Analyzing the goal and available project context");
  }

  async execute(raw: AgentToolCall, handler: (call: NovaToolCall) => Promise<Record<string, unknown>>): Promise<NovaToolResult> {
    const definition = toolDefinition(raw.function.name);
    if (!definition) throw new Error(`Unknown Nova tool: ${raw.function.name}`);
    const call = parseToolCall(raw, definition, this.project.rootPath);
    const decision = evaluateToolPolicy(call, this.project);
    if (!decision.allowed) {
      this.task.event("error", "failed", decision.reason || "Tool blocked by policy", undefined, call.id, call.toolName);
      throw new Error(decision.reason || "Tool blocked by Nova policy");
    }
    if (decision.approval) {
      this.onStatus("Waiting for your approval…");
      this.task.event("permission", "waiting_permission", definition.nova.label, approvalCopy(call).detail, call.id, call.toolName);
      if (!await this.requestApproval(approvalCopy(call))) {
        this.task.event("permission", "cancelled", "Permission was not granted", undefined, call.id, call.toolName);
        throw new Error("__NOVA_PERMISSION_DENIED__");
      }
    }
    this.onStatus(definition.nova.label);
    this.task.event("tool", "running", definition.nova.label, undefined, call.id, call.toolName);
    const started = performance.now();
    try {
      const data = await handler(call);
      const image = typeof data.__novaImage === "string" ? data.__novaImage : undefined;
      const structuredData = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "__novaImage"));
      const result: NovaToolResult = { callId: call.id, status: "success", structuredData, changedFiles: Array.isArray(data.changedFiles) ? data.changedFiles as string[] : undefined, durationMs: Math.round(performance.now() - started), __novaImage: image };
      this.task.event("result", "running", `${definition.nova.label.replace(/…$/, "")} complete`, undefined, call.id, call.toolName);
      this.onStatus("Planning the next step…");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.task.event("error", "failed", `${definition.nova.label.replace(/…$/, "")} failed`, message, call.id, call.toolName);
      throw error;
    }
  }

  complete() { this.task.event("task", "completed", "Task completed"); }
  fail(detail: string) { this.task.event("error", "failed", "Task failed", detail); }
  cancel() { this.task.event("task", "cancelled", "Task cancelled"); }
}
