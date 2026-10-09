/** Only registered tool names count as commands; emails and unknown mentions do not. */
export function toolCommands(text: string, available: readonly string[]): string[] {
  const registry = new Set(available);
  return [...new Set([...text.matchAll(/(?:^|\s)@([a-z][a-z0-9_]*)(?=$|[\s.,:;!?])/g)].map(match => match[1]).filter(name => registry.has(name)))];
}

export function commandInstructions(names: readonly string[]): string {
  return names.length ? `The user explicitly requested these registered tools: ${names.join(', ')}. Call every requested tool using arguments derived from the user's request. Ask for missing required information rather than inventing it. Follow the normal plan and approval policy. A tool mention is not permission to bypass approval. Do not report success unless the requested tools actually succeeded.` : '';
}
