import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  BookOpen,
  Brain,
  ClockCounterClockwise,
  GearSix,
  Key,
  PlugsConnected,
  Pulse,
  SidebarSimple,
} from "@phosphor-icons/react";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const storageKey = "agent-mcp-nav";
export const contentColumnClass = "mx-auto w-full max-w-6xl";

function readExpanded(): boolean {
  try {
    return localStorage.getItem(storageKey) === "expanded";
  } catch {
    return false;
  }
}

function storeExpanded(next: boolean) {
  try {
    localStorage.setItem(storageKey, next ? "expanded" : "collapsed");
  } catch {
    /* storage unavailable */
  }
}

const items: { href: string; label: string; icon: ComponentType<{ weight?: "bold" }> }[] = [
  { href: "/", label: "Feed", icon: Pulse },
  { href: "/sessions", label: "Sesi", icon: ClockCounterClockwise },
  { href: "/keys", label: "Kunci", icon: Key },
  { href: "/clients", label: "Klien", icon: PlugsConnected },
  { href: "/memories", label: "Memori", icon: Brain },
  { href: "/skills", label: "Skill", icon: BookOpen },
  { href: "/settings", label: "Pengaturan", icon: GearSix },
];

function selected(href: string, path: string): boolean {
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}

export function Shell({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) {
  const path = window.location.pathname;
  const [expanded, setExpanded] = useState(readExpanded);

  function writeExpanded(next: boolean) {
    setExpanded(next);
    storeExpanded(next);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "b") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      event.preventDefault();
      setExpanded((current) => {
        const next = !current;
        storeExpanded(next);
        return next;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative flex h-screen bg-background text-foreground">
      <nav
        id="operator-nav"
        aria-label="Navigasi"
        className={cn(
          "flex shrink-0 flex-col gap-2 border-r border-border py-3",
          expanded ? "w-[220px] px-3" : "w-16 items-center",
        )}
      >
        <Brand expanded={expanded} />
        {items.map((item) => (
          <NavItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            expanded={expanded}
            current={selected(item.href, path)}
          />
        ))}
      </nav>
      <button
        type="button"
        className={cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "absolute top-4 z-10 -translate-x-1/2 border-border bg-card text-muted-foreground",
          expanded ? "left-[220px]" : "left-16",
        )}
        aria-expanded={expanded}
        aria-controls="operator-nav"
        aria-keyshortcuts="b"
        onClick={() => writeExpanded(!expanded)}
      >
        <SidebarSimple weight="bold" />
        <span className="sr-only">{expanded ? "Tutup navigasi" : "Buka navigasi"}</span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border">
          <div className={cn(contentColumnClass, "flex h-14 items-center gap-4 px-4")}>
            <span className="text-sm font-medium tracking-tight">Agent</span>
            {toolbar}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">
          <div className={cn(contentColumnClass, "p-4")}>{children}</div>
        </main>
      </div>
    </div>
  );
}

function Brand({ expanded }: { expanded: boolean }) {
  return (
    <div
      className={cn(
        "relative flex h-10 items-center",
        expanded ? "w-full gap-3 px-1" : "size-10 justify-center overflow-hidden",
      )}
    >
      <img src="/favicon.svg" alt="" width={40} height={40} className="size-10 shrink-0" aria-hidden="true" />
      <span
        className={cn(
          "truncate text-sm font-medium transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "translate-x-0 opacity-100" : "pointer-events-none absolute -translate-x-1 opacity-0",
        )}
      >
        Agent MCP
      </span>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  expanded,
  current,
}: {
  href: string;
  label: string;
  icon: ComponentType<{ weight?: "bold" }>;
  expanded: boolean;
  current: boolean;
}) {
  const link = (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      aria-label={expanded ? undefined : label}
      className={cn(
        "relative flex h-10 items-center rounded-full text-sm no-underline transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none",
        expanded ? "w-full gap-3 px-3" : "size-10 justify-center overflow-hidden",
        current ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon weight="bold" />
      <span
        aria-hidden={expanded ? undefined : true}
        className={cn(
          "truncate transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "translate-x-0 opacity-100" : "pointer-events-none absolute -translate-x-1 opacity-0",
        )}
      >
        {label}
      </span>
    </a>
  );
  if (expanded) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  );
}

export function LoadingRows() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-10" />
      ))}
    </div>
  );
}

export function Failed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-muted-foreground">Gagal dimuat.</p>
      <Button type="button" onClick={onRetry}>Coba lagi</Button>
    </div>
  );
}

export function EmptyState({ children }: { children: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{children}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

export function formatWhen(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
