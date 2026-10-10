import type { AgentTool } from './ai';

export const INPUT_TOOL = 'collect_user_input';
export type InputQuestion = { id: string; question: string; options: string[] };
export type InputRequest = { title: string; questions: InputQuestion[] };
export type InputAnswers = { id: string; question: string; answer: string }[];
export type InputSession = InputRequest & { submit: (answers: Record<string, string>) => void; cancel: () => void };
export const inputTool: AgentTool = { type: 'function', function: {
  name: INPUT_TOOL,
  description: 'Ask the user for missing information through an inline step-by-step form, then resume this same task with their answers. Ask only questions not already answered. Provide up to four suggested answers per question or an empty array for free text. Never request passwords, API keys or payment secrets.',
  parameters: { type: 'object', properties: {
    title: { type: 'string', maxLength: 100 },
    questions: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', properties: {
      id: { type: 'string', maxLength: 50 }, question: { type: 'string', maxLength: 600 },
      options: { type: 'array', maxItems: 4, items: { type: 'string', maxLength: 160 } },
    }, required: ['id', 'question', 'options'], additionalProperties: false } },
  }, required: ['title', 'questions'], additionalProperties: false },
} };
export const inputInstructions = 'When a invoked prompt needs missing information, call collect_user_input instead of writing clarification questions as a chat answer. Group the missing questions into a concise form, use the user\'s language, and offer suitable choices when useful. Do not ask again for facts already provided in the prompt or earlier answers. Wait for the real tool result and then continue the requested work. If information is sufficient, produce the result directly. A form is for collecting details, not granting permissions or sending email. Never request durable secrets.';

export function validateInputRequest(value: unknown): InputRequest {
  const input = value as InputRequest;
  const text = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= limit;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['title', 'questions'].includes(key)) || !text(input.title, 100) || !Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 8) throw new Error('Invalid input form. Provide a title and 1–8 questions.');
  const ids = new Set<string>();
  const questions = input.questions.map(question => {
    if (!question || typeof question !== 'object' || Object.keys(question).some(key => !['id', 'question', 'options'].includes(key)) || !text(question.id, 50) || !/^[a-zA-Z0-9_-]+$/.test(question.id) || question.id === '__proto__' || Object.prototype.hasOwnProperty.call(Object.prototype, question.id) || ids.has(question.id) || !text(question.question, 600) || !Array.isArray(question.options) || question.options.length > 4 || question.options.some(option => !text(option, 160))) throw new Error('Invalid or duplicate input question.');
    ids.add(question.id);
    return { id: question.id, question: question.question, options: [...new Set(question.options)] };
  });
  return { title: input.title, questions };
}

export function collectInputAnswers(request: InputRequest, values: Record<string, string>): InputAnswers {
  return request.questions.map(question => {
    const answer = values[question.id];
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 12000) throw new Error('Answer each question before continuing.');
    return { id: question.id, question: question.question, answer: answer.trim() };
  });
}

/** Resolves only after real user answers, never after merely displaying the form. */
export function waitForInput(request: InputRequest, signal: AbortSignal, present: (session: InputSession | null) => void): Promise<InputAnswers> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (answers?: InputAnswers, error?: Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      present(null);
      if (error) reject(error); else resolve(answers!);
    };
    const abort = () => finish(undefined, new DOMException('Input collection stopped', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    present({ ...request, submit: values => {
      if (settled) return;
      // Leave the form open if validation fails.
      const answers = collectInputAnswers(request, values);
      finish(answers);
    }, cancel: () => finish(undefined, new Error('__NOVA_INPUT_CANCELLED__')) });
  });
}
