import { BookOpen, Braces, Calculator, CalendarDays, ChartNoAxesCombined, Code2, Github, Search, Text } from 'lucide-react';

const icons = { github: Github, 'csv-analysis': ChartNoAxesCombined, calculator: Calculator, 'text-analysis': Text, 'json-inspector': Braces, 'date-calculator': CalendarDays, writing: BookOpen, development: Code2, research: Search };
export function PluginIcon({ id }: { id: string }) {
  const Icon = icons[id as keyof typeof icons] || BookOpen;
  return <span className={`plugin-logo plugin-logo-${id}`} aria-hidden="true"><Icon /></span>;
}
