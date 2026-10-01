import type { NovaToolCall } from "./protocol";
import type { WorkProject } from "../types";

const destructiveCommand = /(^|[;&|]\s*)(rm\s+-rf|sudo\b|doas\b|format\b|diskpart\b|shutdown\b|reboot\b|reg\s+(delete|add)\b|Remove-Item\b[^\n]*-Recurse|git\s+(reset\s+--hard|clean\s+-f)|powershell[^\n]*-enc)/i;
const secretLike = /(api[_-]?key|password|passwd|private[_-]?key|recovery[_-]?code|credit\s*card)/i;

export type PolicyDecision = { allowed: boolean; approval: boolean; reason?: string };

export const evaluateToolPolicy = (call: NovaToolCall, project: WorkProject): PolicyDecision => {
  if (call.toolName === "shell_exec") {
    const command = String(call.arguments.command || "");
    if (destructiveCommand.test(command)) return { allowed: false, approval: false, reason: "Nova blocked a destructive or privileged command." };
  }
  if (call.toolName === "computer_type" && secretLike.test(String(call.arguments.text || ""))) {
    return { allowed: false, approval: false, reason: "Nova will not type durable secrets through Computer Use." };
  }
  const access = project.agentAccess || "ask";
  if (call.riskLevel === "critical") return { allowed: false, approval: false, reason: "Critical system actions are not enabled." };
  if (access === "auto") return { allowed: true, approval: false };
  if (access === "safe") return { allowed: true, approval: call.riskLevel === "high" || call.effect === "external" };
  return { allowed: true, approval: call.effect !== "read" || call.permissionScope === "computer" };
};

export const approvalCopy = (call: NovaToolCall) => {
  const args = call.arguments;
  const target = String(args.path || args.url || args.query || args.name || args.purpose || call.toolName);
  return {
    title: call.permissionScope === "filesystem" ? "Nova wants to change this project" : call.permissionScope === "terminal" ? "Nova wants to run a project command" : call.permissionScope === "browser" ? "Nova wants to use the web" : "Nova wants to control the computer",
    detail: target.slice(0, 240),
    risk: call.permissionScope === "filesystem" ? "file" as const : call.permissionScope === "browser" ? "browser" as const : "computer" as const,
  };
};
