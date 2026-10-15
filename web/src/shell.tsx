import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  BookOpen,
  Brain,
  ClockCounterClockwise,
  FileText,
  GearSix,
  Key,
  List,
  Moon,
  PlugsConnected,
  Pulse,
  ShieldCheck,
  SidebarSimple,
  Sun,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { titleForPath } from "./title.ts";

const storageKey = "agent-mcp-nav";
const themeKey = "agent-mcp-theme";
export const contentColumnClass = "mx-auto w-full max-w-[1440px]";

type Icon = ComponentType<{ weight?: "bold"; size?: number }>;
type NavEntry = { href: string; label: string; icon: Icon };
const groups: { label: string; items: NavEntry[] }[] = [
  {
    label: "Aktivitas",
    items: [
      { href: "/", label: "Feed", icon: Pulse },
      { href: "/sessions", label: "Sesi", icon: ClockCounterClockwise },
      { href: "/approvals", label: "Persetujuan", icon: ShieldCheck },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/keys", label: "Kunci API", icon: Key },
      { href: "/clients", label: "Klien", icon: PlugsConnected },
      { href: "/memories", label: "Memori", icon: Brain },
      { href: "/skills", label: "Skill", icon: BookOpen },
    ],
  },
  {
    label: "Bantuan & sistem",
    items: [
      { href: "/settings", label: "Pengaturan", icon: GearSix },
      { href: "/docs", label: "Dokumentasi", icon: FileText },
      { href: "/setup", label: "Setup", icon: Wrench },
    ],
  },
];

const descriptions: Record<string, string> = {
  "/": "Pantau panggilan tool dari seluruh sesi secara langsung.",
  "/sessions": "Riwayat sesi dan aktivitas yang terhubung ke Agent MCP.",
  "/approvals": "Tinjau dan setujui eksekusi berisiko satu per satu.",
  "/keys": "Kelola kredensial untuk menghubungkan klien ke server.",
  "/clients": "Daftar koneksi API key dan OAuth yang pernah digunakan.",
  "/memories": "Catatan persisten yang bisa digunakan kembali oleh agent.",
  "/skills": "Prosedur dan instruksi yang tersedia untuk agent.",
  "/settings": "Konfigurasi server dan preferensi operasional.",
  "/docs": "Panduan penggunaan, integrasi, dan pengoperasian server.",
  "/setup": "Siapkan endpoint dan instruksi untuk ChatGPT atau Claude.",
};

function readExpanded(): boolean {
  try {
    return localStorage.getItem(storageKey) !== "collapsed";
  } catch {
    return true;
  }
}

function storeExpanded(next: boolean) {
  try {
    localStorage.setItem(storageKey, next ? "expanded" : "collapsed");
  } catch {
    // Storage can be disabled.
  }
}

function readTheme(): "dark" | "light" {
  try {
    return localStorage.getItem(themeKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function selected(href: string, path: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

function Navigation({ expanded, path, onNavigate }: {
  expanded: boolean;
  path: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-5" aria-label="Navigasi utama">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          {expanded ? (
            <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.09em] text-muted-foreground/75 uppercase">
              {group.label}
            </p>
          ) : <div aria-hidden="true" className="mx-3 mb-3 border-t border-border" />}
          {group.items.map((item) => (
            <NavItem key={item.href} {...item} expanded={expanded} current={selected(item.href, path)} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

export function Shell({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) {
  const path = window.location.pathname;
  const [expanded, setExpanded] = useState(readExpanded);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobilePanelRef = useRef<HTMLElement>(null);
  const [theme, setTheme] = useState(readTheme);
  const title = path.startsWith("/sessions/") ? "Detail sesi" : path.startsWith("/skills/") && path !== "/skills/new"
    ? "Edit skill" : path === "/skills/new" ? "Skill baru" : titleForPath(path);
  const description = path.startsWith("/sessions/") ? "Log panggilan tool pada sesi terpilih."
    : path.startsWith("/skills/") ? "Kelola detail dan isi prosedur agent."
    : descriptions[path] ?? "Kelola Agent MCP.";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(themeKey, theme);
    } catch {
      // Storage can be disabled.
    }
  }, [theme]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key.toLowerCase() !== "b" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
      )) return;
      event.preventDefault();
      if (window.matchMedia("(max-width: 1023px)").matches) {
        setMobileOpen((current) => !current);
      } else {
        setExpanded((current) => {
          storeExpanded(!current);
          return !current;
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = mobilePanelRef.current;
    document.body.style.overflow = "hidden";
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    focusables()[0]?.focus();

    function trapTab(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const entries = focusables();
      if (!entries.length) return;
      const first = entries[0];
      const last = entries[entries.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", trapTab);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trapTab);
      previouslyFocused?.focus();
    };
  }, [mobileOpen]);

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <a href="#main-content" className="skip-link">Lewati navigasi</a>
      <aside className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out lg:flex motion-reduce:transition-none",
        expanded ? "w-[248px]" : "w-[76px]",
      )}>
        <div className="flex h-[76px] shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4">
          <Brand expanded={expanded} />
          {expanded ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" type="button" aria-label="Perkecil sidebar" aria-expanded={expanded} aria-controls="desktop-nav"
                  onClick={() => { storeExpanded(false); setExpanded(false); }}>
                  <SidebarSimple size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Perkecil sidebar (B)</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
        <div id="desktop-nav" className="flex min-h-0 flex-1 flex-col">
          <Navigation expanded={expanded} path={path} />
        </div>
        <div className="border-t border-sidebar-border p-3">
          {!expanded ? (
            <Button type="button" variant="ghost" size="icon" className="mx-auto flex" aria-label="Perluas sidebar"
              aria-expanded={expanded} aria-controls="desktop-nav" onClick={() => { storeExpanded(true); setExpanded(true); }}>
              <SidebarSimple size={20} />
            </Button>
          ) : (
            <div className="flex items-center justify-between px-3 py-1 text-xs text-muted-foreground">
              <span>Agent MCP</span>
              <kbd className="rounded-md border border-border px-2 py-1 font-mono text-[11px]">B</kbd>
            </div>
          )}
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigasi utama">
          <button type="button" className="absolute inset-0 bg-black/65" aria-label="Tutup navigasi" onClick={() => setMobileOpen(false)} />
          <aside ref={mobilePanelRef} id="mobile-navigation" className="relative flex h-full w-[min(82vw,320px)] flex-col bg-sidebar shadow-2xl" aria-label="Menu navigasi">
            <div className="flex h-[72px] items-center justify-between border-b border-sidebar-border px-4">
              <Brand expanded />
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Tutup menu"><X size={20} /></Button>
            </div>
            <Navigation expanded path={path} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-10 shrink-0 border-b border-border bg-background/95 backdrop-blur-md">
          <div className={cn(contentColumnClass, "flex h-[76px] items-center gap-3 px-5 sm:px-8 lg:px-10")}>
            <Button variant="ghost" size="icon" type="button" className="-ml-2 lg:hidden"
              aria-label="Buka navigasi" aria-expanded={mobileOpen} aria-controls="mobile-navigation"
              onClick={() => setMobileOpen(true)}><List size={22} /></Button>
            <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <span className="hidden text-muted-foreground sm:inline">Workspace</span>
              <span className="hidden text-muted-foreground/50 sm:inline">/</span>
              <span className="truncate font-semibold text-foreground">{title}</span>
            </div>
            {toolbar ? <div className="hidden min-w-0 max-w-[22rem] flex-1 items-center sm:flex">{toolbar}</div> : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" size="icon" variant="ghost" aria-label={theme === "dark" ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                  {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{theme === "dark" ? "Mode terang" : "Mode gelap"}</TooltipContent>
            </Tooltip>
          </div>
        </header>
        <main id="main-content" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto scroll-smooth [scrollbar-gutter:stable]">
          <div className={cn(contentColumnClass, "px-5 pt-9 pb-16 sm:px-8 sm:pt-10 lg:px-10 lg:pt-12")}>
            <div className="page-intro mb-8 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-[clamp(1.75rem,2.8vw,2.5rem)] leading-tight font-semibold tracking-[-0.045em]">{title}</h1>
                <p className="mt-2 max-w-[65ch] text-sm leading-6 text-muted-foreground">{description}</p>
              </div>
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

function Brand({ expanded }: { expanded: boolean }) {
  return (
    <a href="/" className={cn("flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring", !expanded && "mx-auto")}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
        <img src="/favicon.svg" alt="" width={29} height={29} className="size-[29px]" />
      </span>
      {expanded ? (
        <span className="flex min-w-0 flex-col">
          <strong className="truncate text-sm font-semibold tracking-tight">Agent MCP</strong>
          <span className="text-[11px] leading-4 text-muted-foreground">Operator console</span>
        </span>
      ) : null}
    </a>
  );
}

function NavItem({ href, label, icon: Icon, expanded, current, onNavigate }: NavEntry & {
  expanded: boolean;
  current: boolean;
  onNavigate?: () => void;
}) {
  const link = (
    <a href={href} aria-current={current ? "page" : undefined} aria-label={expanded ? undefined : label} onClick={onNavigate}
      className={cn(
        "group relative flex min-h-10 items-center rounded-lg text-[13px] font-medium no-underline transition-[background-color,color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:transition-none motion-reduce:transform-none",
        expanded ? "gap-3 px-3" : "mx-auto size-11 justify-center",
        current ? "bg-primary/12 text-primary" : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}>
      <Icon size={19} weight="bold" />
      {expanded ? <span className="min-w-0 truncate">{label}</span> : <span className="sr-only">{label}</span>}
      {current ? <span className="absolute inset-y-2 -left-3 w-[3px] rounded-r-full bg-primary" aria-hidden="true" /> : null}
    </a>
  );
  if (expanded) return link;
  return <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right" sideOffset={10}>{label}</TooltipContent></Tooltip>;
}

export function LoadingRows() {
  return <div className="flex flex-col gap-3 py-2" aria-label="Memuat data" role="status">
    {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full rounded-lg" />)}
  </div>;
}

export function Failed({ onRetry }: { onRetry: () => void }) {
  return <div className="flex flex-col items-start gap-3 py-9" role="alert">
    <p className="font-medium">Data tidak dapat dimuat</p>
    <p className="text-sm text-muted-foreground">Periksa koneksi ke server lalu coba lagi.</p>
    <Button type="button" variant="outline" onClick={onRetry}>Coba lagi</Button>
  </div>;
}

export function EmptyState({ children }: { children: string }) {
  return <Empty className="min-h-52"><EmptyHeader><EmptyTitle>{children}</EmptyTitle></EmptyHeader></Empty>;
}

export function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
