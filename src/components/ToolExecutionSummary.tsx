import type { Message } from '../types';
import { CheckCheck } from 'lucide-react';
export function ToolExecutionSummary({ message }: { message: Message }) {
  if (!message.toolExecutions?.length) return null;
  return <details className="tool-execution-summary"><summary><CheckCheck />{message.toolExecutions.length} local tool execution{message.toolExecutions.length === 1 ? '' : 's'}</summary>{message.toolExecutions.map((item, index) => <div key={index}><b>@{item.name}</b><pre dir="ltr">{item.result}</pre></div>)}</details>;
}
