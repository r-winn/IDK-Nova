import type { Config } from '../types';
import { getActiveProvider } from '../types';
import { loadValue } from './storage';

export type TokenUsage = { input: number; output: number; cached: number };
export type UsageRecord = TokenUsage & { id: string; at: number; providerId: string; providerName: string; model: string; workId?: string; durationMs: number; firstTextMs?: number; requests: number; reportedRequests: number; status: 'complete' | 'failed' | 'stopped'; cost?: number };
export type ModelPrice = { input?: number; output?: number; cached?: number };
export const usageRecords = () => loadValue<UsageRecord[]>('nova-usage-v1', []);
export const modelPrices = () => loadValue<Record<string, ModelPrice>>('nova-prices-v1', {});
export function parseUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== 'object') return;
  const usage = value as Record<string, any>;
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return;
  const cached = usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  return { input, output, cached: Number.isFinite(cached) ? Math.max(0, Math.min(input, cached)) : 0 };
}
export class UsageTracker {
  private started = performance.now();
  private firstTextMs?: number;
  private requests = 0;
  private reportedRequests = 0;
  private tokens: TokenUsage = { input: 0, output: 0, cached: 0 };
  private finished = false;
  constructor(private config: Config, private workId?: string) {}
  text(token: string) { if (token && this.firstTextMs === undefined) this.firstTextMs = Math.round(performance.now() - this.started); }
  report(usage: unknown) {
    this.requests++;
    const parsed = parseUsage(usage);
    if (!parsed) return;
    this.reportedRequests++;
    this.tokens.input += parsed.input; this.tokens.output += parsed.output; this.tokens.cached += parsed.cached;
  }
  finish(status: UsageRecord['status']) {
    if (this.finished) return;
    this.finished = true;
    const provider = getActiveProvider(this.config);
    if (!provider) return;
    const price = modelPrices()[`${provider.id}::${this.config.activeModel}`];
    const completeUsage = this.requests > 0 && this.reportedRequests === this.requests;
    const rates = [price?.input ?? NaN, price?.output ?? NaN, price?.cached ?? NaN];
    const cost = rates.every(rate => Number.isFinite(rate) && rate >= 0) && completeUsage ? ((this.tokens.input - this.tokens.cached) * rates[0] + this.tokens.cached * rates[2] + this.tokens.output * rates[1]) / 1_000_000 : undefined;
    const record: UsageRecord = { ...this.tokens, id: crypto.randomUUID(), at: Date.now(), providerId: provider.id, providerName: provider.name, model: this.config.activeModel, workId: this.workId, durationMs: Math.round(performance.now() - this.started), firstTextMs: this.firstTextMs, requests: this.requests, reportedRequests: this.reportedRequests, status, cost };
    try {
      localStorage.setItem('nova-usage-v1', JSON.stringify([...usageRecords(), record].slice(-10000)));
      window.dispatchEvent(new Event('nova-usage-updated'));
    } catch { /* Storage quota must never turn a successful AI response into a failure. */ }
  }
}
