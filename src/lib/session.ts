import type { MenuSession } from "@/app/actions/upload-menu";

// The Pinecone namespace survives a refresh (so the menu needn't be
// re-embedded) but the chat itself lives only in useChat memory.
const KEY = "menu-session";

export function saveMenuSession(session: MenuSession) {
  sessionStorage.setItem(KEY, JSON.stringify(session));
}

/** Raw stored JSON for useSyncExternalStore; strings keep the snapshot stable. */
export const readMenuSession = () => sessionStorage.getItem(KEY);

export const subscribeMenuSession = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};
