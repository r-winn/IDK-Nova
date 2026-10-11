import { BookOpen, Braces, Calculator, CalendarDays, ChartNoAxesCombined, Code2, Github, Search, Text, FileText, Sheet, Presentation, Chrome, GraduationCap, BriefcaseBusiness } from 'lucide-react';

const icons = { chrome: Chrome, powerpoint: Presentation, articles: BookOpen, academic: GraduationCap, business: BriefcaseBusiness, 'data-work': Sheet, word: FileText, excel: Sheet, github: Github, 'csv-analysis': ChartNoAxesCombined, calculator: Calculator, 'text-analysis': Text, 'json-inspector': Braces, 'date-calculator': CalendarDays, writing: BookOpen, development: Code2, research: Search };
export function PluginIcon({ id }: { id: string }) {
  const Icon = icons[id as keyof typeof icons] || BookOpen;
  return <span className={`plugin-logo plugin-logo-${id}`} aria-hidden="true"><Icon /></span>;
}
