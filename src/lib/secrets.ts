const knownSecrets = new Set<string>();
export function registerSecrets(values: string[]) { for (const value of values) if (value.length >= 6) knownSecrets.add(value); }
export function redactSecrets(text: string): string {
  let result = text;
  for (const secret of knownSecrets) result = result.split(secret).join('[REDACTED]');
  return result.replace(/\bBearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]').replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]').replace(/((?:api[_-]?key|password|secret|access[_-]?token)\s*[=:]\s*["']?)[^\s"',}]+/gi, '$1[REDACTED]');
}
