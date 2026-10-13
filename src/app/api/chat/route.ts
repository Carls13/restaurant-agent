import { randomUUID } from "node:crypto";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { waiterGraph } from "@/lib/agent/graph";
import { NAMESPACE_PATTERN } from "@/lib/pinecone";
import type { AddToCartOutput, ChatMessage } from "@/lib/cart";

export const maxDuration = 60;

type ChatRequest = {
  messages: ChatMessage[];
  namespace: string;
  categories?: string[];
  restaurantName?: string;
};

/** The browser owns the chat history; replay it to the graph as LangChain messages. */
function toLangChain(messages: ChatMessage[]): BaseMessage[] {
  return messages.flatMap((message): BaseMessage[] => {
    const text = message.parts
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "tool-add_to_cart" && part.state === "output-available") {
          const { quantity, itemName, price, lineTotal } = part.output;
          return `[Added to cart: ${quantity}× ${itemName} at €${price.toFixed(2)} each = €${lineTotal.toFixed(2)}]`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (!text) return [];
    return message.role === "user" ? [new HumanMessage(text)] : [new AIMessage(text)];
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;
  if (!NAMESPACE_PATTERN.test(body.namespace ?? "")) {
    return Response.json({ error: "Upload a menu first." }, { status: 400 });
  }

  const stream = createUIMessageStream<ChatMessage>({
    async execute({ writer }) {
      writer.write({ type: "start" });
      const textId = randomUUID();
      let textStarted = false;
      const writeText = (delta: string) => {
        if (!textStarted) {
          writer.write({ type: "text-start", id: textId });
          textStarted = true;
        }
        writer.write({ type: "text-delta", id: textId, delta });
      };

      let cartItems: AddToCartOutput[] = [];
      const graphStream = await waiterGraph.stream(
        {
          messages: toLangChain(body.messages.slice(-12)),
          namespace: body.namespace,
          categories: (body.categories ?? []).slice(0, 50),
          restaurantName: body.restaurantName?.slice(0, 80),
        },
        { streamMode: "updates", signal: req.signal },
      );

      // improve_answer validates prices before replying, so its message is
      // sent whole rather than token by token.
      for await (const update of graphStream) {
        if (update.off_topic) writeText(update.off_topic.messages?.[0]?.text ?? "");
        if (update.improve_answer) writeText(update.improve_answer.messages?.[0]?.text ?? "");
        if (update.add_to_cart) cartItems = update.add_to_cart.cartItems ?? [];
      }

      if (textStarted) writer.write({ type: "text-end", id: textId });

      // Emit receipts after the text so they render beneath the waiter's reply.
      for (const item of cartItems) {
        const toolCallId = randomUUID();
        const input = { itemName: item.itemName, quantity: item.quantity, price: item.price };
        writer.write({ type: "tool-input-available", toolCallId, toolName: "add_to_cart", input });
        writer.write({ type: "tool-output-available", toolCallId, output: item });
      }

      writer.write({ type: "finish" });
    },
    onError: (error) => {
      console.error("Chat stream failed", error);
      return "Sorry, the kitchen line got tangled — please try again.";
    },
  });

  return createUIMessageStreamResponse({ stream });
}
