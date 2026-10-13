export function Logo({ name = "Dim Sum Montijo" }: { name?: string }) {
  return (
    <span className="flex items-center gap-2 font-bold text-ink">
      <span className="grid size-8 place-items-center rounded-lg bg-brand text-white" aria-hidden>
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
          <path d="M5 3v8a3 3 0 0 0 6 0V3M8 3v18M17 3c-2 2-2 6 0 8v10" />
        </svg>
      </span>
      {name}
    </span>
  );
}
