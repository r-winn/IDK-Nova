import type { Chat } from '../types';

export function normalHistoryIfEmpty(chats: Chat[], freshId: number): Chat[] | null {
  if (chats.some(chat => chat.messages.length > 0 && !chat.temporary && !chat.archived)) return null;
  return [{ id: freshId, title: 'New conversation', time: 'Today', messages: [] }, ...chats.filter(chat => chat.archived)];
}

/** Empty drafts are not conversations. After the last conversation is removed,
 * start a fresh normal chat with a fresh workspace session. */
export function chatsAfterDeletion(chats: Chat[], deletedId: number, activeId: number, freshId: number) {
  const deleted = chats.find(chat => chat.id === deletedId);
  let remaining = chats.filter(chat => chat.id !== deletedId);
  const normal = normalHistoryIfEmpty(remaining, freshId);
  if (normal) {
    return { chats: normal, active: freshId, workspaceId: null, resetNavigation: true };
  }
  if (activeId === deletedId && deleted?.workspaceId) {
    let replacement = remaining.find(chat => !chat.archived && chat.workspaceId === deleted.workspaceId);
    if (!replacement) {
      replacement = { id: freshId, title: 'New work chat', time: 'Today', messages: [], workspaceId: deleted.workspaceId };
      remaining = [replacement, ...remaining];
    }
    return { chats: remaining, active: replacement.id, workspaceId: deleted.workspaceId, resetNavigation: false };
  }
  return { chats: remaining, active: activeId === deletedId ? remaining[0].id : activeId, workspaceId: undefined, resetNavigation: false };
}
