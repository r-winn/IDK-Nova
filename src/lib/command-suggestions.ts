export type CommandOption = { name: string; label: string; kind: string };
export function mentionAt(value: string, caret: number) {
  const match = /(?:^|\s)@([a-z0-9_]*)$/i.exec(value.slice(0, caret));
  if (!match) return null;
  const start = caret - match[1].length - 1;
  const suffix = /^[a-z0-9_]*/i.exec(value.slice(caret))![0];
  return { start, end: caret + suffix.length, query: match[1].toLowerCase() };
}
export function suggestCommands(options: CommandOption[], query: string) {
  return options.filter((item, index) => options.findIndex(other => other.name === item.name) === index && item.name.toLowerCase().includes(query)).sort((a, b) => Number(b.name.startsWith(query)) - Number(a.name.startsWith(query)) || a.name.localeCompare(b.name)).slice(0, 8);
}
