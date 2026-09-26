import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export type NativeUpdate = Update;
export type DownloadProgress = { percent: number; downloaded: number; total: number };

export function isDesktopApp() {
  return '__TAURI_INTERNALS__' in window;
}

export async function findNativeUpdate() {
  return check({ timeout: 30_000 });
}

export async function downloadNativeUpdate(update: Update, onProgress: (progress: DownloadProgress) => void) {
  let downloaded = 0;
  let total = 0;
  await update.download(event => {
    if (event.event === 'Started') total = event.data.contentLength || 0;
    if (event.event === 'Progress') downloaded += event.data.chunkLength;
    onProgress({ downloaded, total, percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0 });
  });
}

export async function installNativeUpdate(update: Update) {
  await update.install();
  await relaunch();
}
