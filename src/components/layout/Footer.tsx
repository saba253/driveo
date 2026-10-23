import { Container } from "@/components/ui/Container";
import { Icon } from "@/components/ui/Icon";
import { Wordmark } from "@/components/ui/Wordmark";
import { brand } from "@/config/brand";
import { ka } from "@/content/ka";

const t = ka.footer;

/* Contacts render as links once set in brand config; until then an honest placeholder. */
const contacts = [
  { key: "phone", value: brand.contact.phone, href: (v: string) => `tel:${v.replace(/\s/g, "")}` },
  { key: "email", value: brand.contact.email, href: (v: string) => `mailto:${v}` },
  { key: "telegram", value: brand.contact.telegram, href: (v: string) => `https://t.me/${v.replace(/^@/, "")}` },
] as const;

export function Footer() {
  return (
    <footer className="border-t border-line pt-14 pb-10">
      <Container>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 sm:col-span-2 lg:col-span-1">
            <Wordmark className="text-xl" />
            <p className="mt-3 max-w-xs text-fg-muted">{t.tagline}</p>
          </div>

          <nav aria-label={t.navLabel} className="min-w-0">
            <ul className="space-y-1">
              {ka.nav.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className="inline-flex min-h-11 min-w-11 items-center rounded-sm text-fg-muted transition-colors hover:text-fg">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0">
            <h2 className="text-sm font-medium text-fg-subtle">{t.contactTitle}</h2>
            <dl className="mt-3 space-y-3">
              {contacts.map((c) => (
                <div key={c.key}>
                  <dt className="text-sm text-fg-subtle">{t.contactLabels[c.key]}</dt>
                  <dd className="mt-0.5">
                    {c.value ? (
                      <a href={c.href(c.value)} className="inline-flex min-h-11 items-center rounded-sm text-fg transition-colors hover:text-accent">
                        {c.value}
                      </a>
                    ) : (
                      <span className="text-fg-muted">{t.contactPending}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-line pt-6 text-sm text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {brand.displayName} · {t.prototypeNote}
          </p>
          <a href="#top" className="inline-flex min-h-11 min-w-11 items-center gap-2 self-start rounded-sm text-fg-muted transition-colors hover:text-fg sm:self-auto">
            {t.backToTop}
            <Icon name="arrowUp" size={16} />
          </a>
        </div>
      </Container>
    </footer>
  );
}
