import type { AgentTask, TaskEvent, TaskState } from "./protocol";

const KEY = "idk-nova-agent-tasks-v1";

const read = (): AgentTask[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") as AgentTask[]; }
  catch { return []; }
};

const write = (tasks: AgentTask[]) => localStorage.setItem(KEY, JSON.stringify(tasks.slice(-100)));

export class AgentTaskStore {
  task: AgentTask;

  constructor(chatId: number, workspaceId: string, goal: string) {
    const now = Date.now();
    this.task = { id: `task-${now}-${Math.random().toString(36).slice(2, 8)}`, chatId, workspaceId, goal, state: "created", createdAt: now, updatedAt: now, events: [] };
    this.persist();
  }

  event(kind: TaskEvent["kind"], state: TaskState, label: string, detail?: string, callId?: string, toolName?: string) {
    this.task.state = state;
    this.task.updatedAt = Date.now();
    this.task.events.push({ id: `event-${this.task.updatedAt}-${this.task.events.length}`, taskId: this.task.id, at: this.task.updatedAt, kind, state, label, detail, callId, toolName });
    this.persist();
  }

  private persist() {
    const tasks = read().filter((item) => item.id !== this.task.id);
    tasks.push(this.task);
    write(tasks);
  }
}
