import { Logo } from "@/components/logo";
import { UploadCard } from "@/components/upload-card";

const FEATURES = [
  {
    icon: "🛡️",
    title: "Dietary Safety",
    body: "Instant answers for allergies and dietary preferences across your entire menu.",
  },
  {
    icon: "🥟",
    title: "AI Recommendations",
    body: "Personalized dish pairings based on what guests are craving.",
  },
  {
    icon: "⚡",
    title: "Instant Ordering",
    body: "Turn browsing into orders in seconds. No more waving down busy staff.",
  },
];

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-ink/5 bg-white/90 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Logo />
          <a
            href="#upload"
            className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Get Started
          </a>
        </nav>
      </header>

      <main className="flex-1">
        <section className="relative overflow-hidden bg-[radial-gradient(ellipse_at_top,#8a5a32_0%,#3b2414_55%,#1f130b_100%)] px-6 pb-36 pt-20 text-center text-white">
          <span className="inline-block rounded-full bg-brand/20 px-3 py-1 text-xs font-semibold text-brand">
            ● AI-powered menu assistant
          </span>
          <h1 className="mx-auto mt-6 max-w-2xl text-5xl font-medium leading-tight tracking-tight sm:text-6xl">
            Skip the wait. Your <span className="text-brand">digital waiter</span> is ready.
          </h1>
          <p className="mx-auto mt-5 max-w-md text-white/75">
            Ask about dietary restrictions, get recommendations, and build your order in seconds
            with our AI-powered menu assistant.
          </p>
        </section>

        <div className="px-6">
          <UploadCard />
        </div>

        <section className="mx-auto grid max-w-3xl gap-4 px-6 py-16 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl bg-white p-5 text-center shadow-sm">
              <span className="mx-auto grid size-9 place-items-center rounded-full bg-brand-soft" aria-hidden>
                {f.icon}
              </span>
              <h3 className="mt-3 text-sm font-bold">{f.title}</h3>
              <p className="mt-1 text-xs text-ink/60">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-ink/5 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-xs text-ink/50">
          <Logo />
          <span>© 2026 Dim Sum Montijo. All rights reserved.</span>
        </div>
      </footer>
    </>
  );
}
