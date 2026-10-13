"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { MenuSession } from "@/app/actions/upload-menu";
import { cartLines, formatEuro, type ChatMessage } from "@/lib/cart";
import { Logo } from "./logo";
import { Receipt } from "./receipt";

const SUGGESTIONS = ["Vegetarian options?", "What's the spiciest?", "I have a peanut allergy"];

const CATEGORY_EMOJI: [RegExp, string][] = [
  [/soup/i, "🍜"],
  [/rice|vegetable/i, "🍚"],
  [/dessert|sweet/i, "🍡"],
  [/beverage|drink/i, "🍵"],
  [/bao|bun/i, "🥯"],
  [/crepe/i, "🌯"],
];
const emojiFor = (category: string) =>
  CATEGORY_EMOJI.find(([re]) => re.test(category))?.[1] ?? "🥟";

export function Chat({ session }: { session: MenuSession }) {
  // Chat history lives only in this hook's memory: a refresh starts over.
  const { messages, sendMessage, status, error } = useChat<ChatMessage>({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: {
        namespace: session.namespace,
        categories: session.categories,
        restaurantName: session.restaurantName,
      },
    }),
  });
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";

  const lines = useMemo(() => cartLines(messages), [messages]);
  const cartTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const cartCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  // Running total at each receipt, keyed by tool call, so older receipts
  // keep showing the total as it was at that point in the conversation.
  const runningTotals = useMemo(() => {
    const totals = new Map<string, number>();
    let running = 0;
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === "tool-add_to_cart" && part.state === "output-available") {
          running += part.output.lineTotal;
          totals.set(part.toolCallId, running);
        }
      }
    }
    return totals;
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text: text.trim() });
    setInput("");
  };

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col bg-cream sm:border-x sm:border-ink/5">
      <header className="flex items-center justify-between bg-white px-4 py-3 shadow-sm">
        <Link href="/" title="Upload a different menu">
          <Logo name={session.restaurantName} />
        </Link>
        <div
          className="flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand"
          aria-label={`Cart: ${cartCount} items, ${formatEuro(cartTotal)}`}
        >
          🛍️ {cartCount}
          {cartCount > 0 && <span className="text-ink/70">· {formatEuro(cartTotal)}</span>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <section className="px-4 pt-4">
          <div className="flex items-center justify-between text-xs font-bold tracking-wider text-ink/50">
            ON THE MENU
            <span className="font-medium text-brand">{session.itemCount} items</span>
          </div>
          <div className="mt-2 flex gap-3 overflow-x-auto pb-2">
            {session.highlights.map((item) => (
              <button
                key={item.itemName}
                type="button"
                onClick={() => send(`Tell me about the ${item.itemName}`)}
                className="w-28 shrink-0 text-left"
              >
                <div className="relative grid h-24 place-items-center rounded-xl bg-gradient-to-br from-[#5a3a22] to-[#2b1a0e] text-4xl shadow-sm">
                  {emojiFor(item.category)}
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {formatEuro(item.price)}
                  </span>
                </div>
                <p className="mt-1.5 truncate text-xs font-bold">{item.itemName}</p>
                <p className="truncate text-[11px] text-ink/50">{item.description || item.category}</p>
              </button>
            ))}
          </div>
        </section>

        <ol className="space-y-3 px-4 py-4">
          <Bubble role="assistant">
            Hi! I&apos;m your {session.restaurantName} assistant. Craving something specific or need
            help with allergies?
          </Bubble>

          {messages.map((message) => (
            <li key={message.id} className={message.role === "user" ? "flex justify-end" : ""}>
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  return <Bubble key={i} role={message.role} as="div">{part.text}</Bubble>;
                }
                if (part.type === "tool-add_to_cart" && part.state === "output-available") {
                  return (
                    <div key={i} className="ml-9">
                      <Receipt item={part.output} cartTotal={runningTotals.get(part.toolCallId) ?? 0} />
                    </div>
                  );
                }
                return null;
              })}
            </li>
          ))}

          {status === "submitted" && (
            <Bubble role="assistant">
              <span className="inline-flex gap-1" aria-label="Waiter is typing">
                <span className="size-1.5 animate-bounce rounded-full bg-ink/40" />
                <span className="size-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:120ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-ink/40 [animation-delay:240ms]" />
              </span>
            </Bubble>
          )}
          {error && (
            <li role="alert" className="text-center text-sm text-red-600">
              Something went wrong. Please try again.
            </li>
          )}
        </ol>
        <div ref={bottomRef} />
      </div>

      <footer className="bg-white px-4 pb-4 pt-2 shadow-[0_-1px_0_rgba(0,0,0,0.04)]">
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={busy}
              className="shrink-0 rounded-full border border-brand/40 px-3 py-1 text-xs text-brand hover:bg-brand-soft disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2 rounded-full bg-cream py-1 pl-4 pr-1"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about ingredients, items…"
            aria-label="Message"
            className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-ink/40"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="grid size-8 place-items-center rounded-full bg-brand text-white disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
              <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" />
            </svg>
          </button>
        </form>
      </footer>
    </div>
  );
}

function Bubble({
  role,
  children,
  as: Tag = "li",
}: {
  role: string;
  children: React.ReactNode;
  as?: "li" | "div";
}) {
  if (role === "user") {
    return (
      <Tag className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-sm bg-brand px-3.5 py-2 text-sm text-white">
        {children}
      </Tag>
    );
  }
  return (
    <Tag className="flex items-start gap-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand text-xs text-white" aria-hidden>
        🥢
      </span>
      <span className="max-w-[80%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2 text-sm shadow-sm">
        {children}
      </span>
    </Tag>
  );
}
