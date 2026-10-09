type WatchdogToolCall = { function: { name: string; arguments: string } };

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
};

const compactFingerprint = (value: unknown) => {
  const source = stable(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return `${source.length}:${(hash >>> 0).toString(16)}`;
};

const withoutTiming = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutTiming);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !['durationMs', 'callId', 'updatedAt', 'checkedAt'].includes(key)).map(([key, item]) => [key, withoutTiming(item)]));
  return value;
};

/** Stops only demonstrably stalled loops; it does not impose a turn budget. */
export class AgentLoopWatchdog {
  private recent: string[] = [];

  observe(call: WatchdogToolCall, result: unknown) {
    let args: unknown = call.function.arguments;
    try { args = JSON.parse(call.function.arguments); } catch { /* Invalid arguments are still fingerprinted. */ }
    const signature = compactFingerprint({ name: call.function.name, arguments: args, result: withoutTiming(result) });
    this.recent.push(signature);
    if (this.recent.length > 12) this.recent.shift();
    const repeats = (patternSize: number, times: number) => {
      const needed = patternSize * times;
      if (this.recent.length < needed) return false;
      const tail = this.recent.slice(-needed);
      const pattern = tail.slice(0, patternSize);
      return tail.every((item, index) => item === pattern[index % patternSize]);
    };
    if (repeats(1, 4) || repeats(2, 3) || repeats(3, 3)) {
      throw new Error(`__NOVA_AGENT_STALLED__Agent paused after detecting a repeated no-progress action cycle near “${call.function.name}”. Completed work was preserved; review the latest state before continuing.`);
    }
  }
}
