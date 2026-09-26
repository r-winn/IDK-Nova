export type Attachment = { name: string; type: string; url: string };
export type Message = { role: 'user' | 'assistant'; content: string; attachments?: Attachment[]; liked?: boolean };
export type Chat = { id: number; title: string; time: string; messages: Message[]; archived?: boolean };
export type Config = { baseUrl: string; model: string; apiKey: string; temperature: number };
export const defaultConfig: Config = { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2-vision', apiKey: '', temperature: 0.5 };
