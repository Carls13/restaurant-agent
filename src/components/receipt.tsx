import { formatEuro, type AddToCartOutput } from "@/lib/cart";

/** Mini-receipt rendered in place of an add_to_cart tool call. */
export function Receipt({ item, cartTotal }: { item: AddToCartOutput; cartTotal: number }) {
  return (
    <div className="mt-2 w-64 overflow-hidden rounded-xl border border-brand/30 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-brand-soft/60 px-3 py-2 text-[10px] font-bold tracking-wider text-brand">
        ADDED TO ORDER
        <span aria-hidden>🧾</span>
      </div>
      <div className="flex items-center justify-between px-3 py-3 text-sm">
        <span className="flex items-center gap-2">
          <span className="rounded bg-brand-soft px-1.5 py-0.5 text-xs font-bold text-brand">
            {item.quantity}×
          </span>
          <span className="font-semibold">{item.itemName}</span>
        </span>
        <span className="font-semibold">{formatEuro(item.lineTotal)}</span>
      </div>
      <div className="mx-3 flex items-center justify-between border-t border-dashed border-ink/15 py-2 text-xs text-ink/50">
        <span>{formatEuro(item.price)} each</span>
      </div>
      <div className="flex items-center justify-between bg-cream px-3 py-2 text-sm">
        <span className="text-xs font-bold tracking-wider text-ink/50">CART TOTAL</span>
        <span className="font-bold text-brand">{formatEuro(cartTotal)}</span>
      </div>
    </div>
  );
}
