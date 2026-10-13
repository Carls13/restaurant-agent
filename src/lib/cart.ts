import { z } from "zod";
import type { UIMessage } from "ai";

export const addToCartInput = z.object({
  itemName: z.string().describe("Exact menu item name as it appears in the menu context"),
  quantity: z.number().int().min(1).max(50).describe("How many portions the guest wants"),
  price: z.number().nonnegative().describe("Unit price in euros, taken from the menu context"),
});

export type AddToCartInput = z.infer<typeof addToCartInput>;

export type AddToCartOutput = AddToCartInput & {
  lineTotal: number;
};

export type ChatMessage = UIMessage<
  never,
  never,
  { add_to_cart: { input: AddToCartInput; output: AddToCartOutput } }
>;

export const formatEuro = (amount: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(amount);

/** Every successful add_to_cart call in the conversation, oldest first. */
export function cartLines(messages: ChatMessage[]): AddToCartOutput[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "tool-add_to_cart" && part.state === "output-available"
        ? [part.output]
        : [],
    ),
  );
}
