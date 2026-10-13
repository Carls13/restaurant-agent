"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { MenuSession } from "@/app/actions/upload-menu";
import { readMenuSession, subscribeMenuSession } from "@/lib/session";
import { Chat } from "@/components/chat";

export default function ChatPage() {
  const router = useRouter();
  // undefined while server-rendering, null when no menu has been uploaded.
  const raw = useSyncExternalStore(subscribeMenuSession, readMenuSession, () => undefined);
  const session = useMemo(
    () => (raw ? (JSON.parse(raw) as MenuSession) : raw === undefined ? undefined : null),
    [raw],
  );

  useEffect(() => {
    if (session === null) router.replace("/");
  }, [session, router]);

  if (!session) {
    return <div className="grid flex-1 place-items-center text-sm text-ink/50">Loading menu…</div>;
  }
  return <Chat session={session} />;
}
