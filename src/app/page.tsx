import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Wordmark } from "@/components/ui/Wordmark";
import { ka } from "@/content/ka";

/*
 * Step 1.2 foundation preview — verifies tokens and font loading only.
 * Replaced by the real homepage in Step 1.3.
 */
const swatches = [
  ["canvas", "bg-canvas", "#101318"],
  ["surface", "bg-surface", "#1C222B"],
  ["field", "bg-field", "#2B323C"],
  ["accent", "bg-accent", "#D9F66F"],
  ["fg", "bg-fg", "#F6F7F8"],
  ["fg-muted", "bg-fg-muted", "#B7BEC8"],
] as const;

export default function Home() {
  return (
    <main className="py-16 sm:py-24">
      <Container className="space-y-12">
        <Wordmark />

        <div className="max-w-3xl space-y-5">
          <span className="inline-flex rounded-sm border border-accent/40 px-2.5 py-1 text-sm text-accent">
            {ka.prototype.badge}
          </span>
          <h1 className="text-display font-bold">{ka.meta.title}</h1>
          <p className="text-lead text-fg-muted">{ka.meta.description}</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button>Manrope 0123456789</Button>
            <Button variant="secondary">ქართული ტექსტი</Button>
          </div>
        </div>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {swatches.map(([name, cls, hex]) => (
            <li key={name} className="rounded-lg bg-surface p-3 shadow-card">
              <div className={`h-16 rounded-md border border-line ${cls}`} />
              <p className="mt-3 text-sm font-semibold">{name}</p>
              <p className="text-sm text-fg-muted">{hex}</p>
            </li>
          ))}
        </ul>
      </Container>
    </main>
  );
}
