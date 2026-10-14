import type { ReactNode } from "react";

const items = [
  ["/", "Feed"],
  ["/sessions", "Sesi"],
  ["/keys", "Kunci API"],
  ["/clients", "Klien"],
  ["/memories", "Memori"],
  ["/skills", "Skill"],
  ["/settings", "Pengaturan"],
] as const;

function selected(href: string, path: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}

export function Shell({ children }: { children: ReactNode }) {
  const path = window.location.pathname;
  return (
    <div className="flex min-h-screen">
      <nav className="w-[220px] shrink-0 bg-[#09090b]">
        {items.map(([href, label]) => (
          <a
            key={href}
            href={href}
            className={`flex h-10 items-center px-4 no-underline ${selected(href, path) ? "text-[#fafafa]" : "text-[#a1a1aa]"}`}
          >
            {label}
          </a>
        ))}
      </nav>
      <main className="min-w-0 flex-1 p-6">
        <section className="rounded-[12px] bg-[#18181b] p-6">{children}</section>
      </main>
    </div>
  );
}

export function Loading() {
  return (
    <div>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="mb-2 h-10 rounded-[8px] bg-[#27272a]" />
      ))}
    </div>
  );
}

export function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div>
      <p className="text-[#a1a1aa]">Gagal dimuat.</p>
      <button type="button" className="mt-3 h-10 rounded-[8px] bg-[#047857] px-4 text-white" onClick={onRetry}>
        Coba lagi
      </button>
    </div>
  );
}

export const fieldClass = "h-10 w-full rounded-[8px] border-0 bg-[#09090b] px-3 text-[#fafafa]";
export const buttonClass = "h-10 rounded-[8px] bg-[#047857] px-4 text-white";
