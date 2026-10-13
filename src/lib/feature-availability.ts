// Environment checks affect presentation/selection, never stored configuration.
export function pluginAvailability(id: string, desktop: boolean, work = false) {
  if (id === 'chrome' && !desktop) return { available: false, reason: 'Requires the desktop app and a Work project' };
  if (id === 'chrome' && !work) return { available: false, reason: 'Select this plugin in a desktop Work chat' };
  return { available: true, reason: '' };
}
export function availablePluginIds(ids: string[], desktop: boolean, work = false) {
  return ids.filter(id => pluginAvailability(id, desktop, work).available);
}
