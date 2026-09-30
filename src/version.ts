// Web fallback. The desktop app replaces this with the version embedded in the
// installed Tauri package, so the UI always reflects the executable in use.
export const APP_VERSION = '0.16.1';
export const UPDATE_MANIFEST = 'https://r-winn.github.io/IDK-Nova/version.json';
export type UpdateManifest = { version: string; releaseUrl: string; installerUrl: string; notes: string[] };
export const isNewerVersion = (remote: string, current: string) => remote.split('.').map(Number).some((part, index) => part > (current.split('.').map(Number)[index] || 0) && remote.split('.').slice(0, index).every((value, i) => Number(value) === (current.split('.').map(Number)[i] || 0)));
