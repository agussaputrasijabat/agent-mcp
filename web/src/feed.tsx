import { useEffect, useState } from "react";
import { ArrowClockwise, MagnifyingGlass, Pulse } from "@phosphor-icons/react";
import { api } from "./api.ts";
import { EmptyState, LoadingRows, Shell, formatDuration, formatWhen } from "./shell.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type CallRow = {
  id: string;
  tool_name: string;
  started_at: string;
  session_key: string;
  duration_ms: number | null;
  is_error: number;
};

type StatusFilter = "all" | "ok" | "error";

function initialFilter(): { query: string; status: StatusFilter } {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status");
  return {
    query: params.get("q") ?? "",
    status: status === "ok" || status === "error" ? status : "all",
  };
}

export function FeedPage() {
  return <Shell><FeedBody /></Shell>;
}

function FeedBody() {
  const [filters, setFilters] = useState(initialFilter);
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function updateFilters(next: typeof filters) {
    setFilters(next);
    const url = new URL(window.location.href);
    if (next.query) url.searchParams.set("q", next.query);
    else url.searchParams.delete("q");
    if (next.status !== "all") url.searchParams.set("status", next.status);
    else url.searchParams.delete("status");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  useEffect(() => {
    const onPopState = () => setFilters(initialFilter());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  async function load(initial = false) {
    if (initial) setRows(null);
    setRefreshing(true);
    const result = await api<{ items: CallRow[] }>("/api/tool-calls?limit=50");
    if (!result.ok) {
      setFailed(true);
    } else {
      setFailed(false);
      setRows(result.data.items);
    }
    setRefreshing(false);
  }

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const allRows = rows ?? [];
  const success = allRows.filter((row) => !row.is_error).length;
  const errors = allRows.length - success;
  const needle = filters.query.trim().toLowerCase();
  const visible = allRows.filter((row) =>
    (!needle || row.tool_name.toLowerCase().includes(needle) || row.session_key.toLowerCase().includes(needle)) &&
    (filters.status === "all" || (filters.status === "error" ? Boolean(row.is_error) : !row.is_error)),
  );

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Ringkasan aktivitas" className="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-card">
        <Metric label="Total panggilan" value={rows === null ? null : allRows.length} detail="50 aktivitas terbaru" />
        <Metric label="Berhasil" value={rows === null ? null : success} detail="Panggilan tanpa error" tone="positive" />
        <Metric label="Error" value={rows === null ? null : errors} detail="Panggilan yang gagal" tone={errors ? "negative" : undefined} />
      </section>

      <Card>
        <CardHeader className="gap-2 sm:gap-1">
          <CardTitle className="flex items-center gap-2"><Pulse className="text-primary" size={19} weight="bold" />Panggilan terbaru</CardTitle>
          <CardDescription>Aktivitas terbarui otomatis saat server menerima panggilan tool.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1 rounded-lg bg-muted/70 p-1" aria-label="Filter status">
              {([
                ["all", "Semua"],
                ["ok", "Berhasil"],
                ["error", "Error"],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={filters.status === value}
                  onClick={() => updateFilters({ ...filters, status: value })}
                  className={
                    "min-h-9 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 " +
                    (filters.status === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                  }>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <InputGroup className="min-w-0 flex-1 sm:w-60">
                <InputGroupAddon><MagnifyingGlass size={17} /></InputGroupAddon>
                <InputGroupInput aria-label="Cari tool atau sesi" placeholder="Cari tool atau sesi"
                  value={filters.query} onChange={(event) => updateFilters({ ...filters, query: event.target.value })} />
              </InputGroup>
              <Button type="button" size="icon" variant="outline" aria-label="Muat ulang feed" disabled={refreshing}
                onClick={() => void load()}><ArrowClockwise size={17} /></Button>
            </div>
          </div>
          {failed ? (
            <div role="alert" className="flex flex-col items-start gap-3 py-8">
              <p className="font-medium">Feed gagal dimuat.</p>
              <p className="text-sm text-muted-foreground">Periksa koneksi ke server lalu coba lagi.</p>
              <Button type="button" variant="outline" onClick={() => void load(true)}>Coba lagi</Button>
            </div>
          ) : null}
          {rows === null && !failed ? <LoadingRows /> : null}
          {rows?.length === 0 && !failed ? <EmptyState>Belum ada panggilan tool.</EmptyState> : null}
          {rows && rows.length > 0 && visible.length === 0 && !failed ? (
            <div className="py-12 text-center text-sm text-muted-foreground" role="status">
              Tidak ada aktivitas yang sesuai filter.
              <div className="mt-3"><Button type="button" variant="outline" size="sm" onClick={() => updateFilters({ query: "", status: "all" })}>Reset filter</Button></div>
            </div>
          ) : null}
          {rows && visible.length > 0 && !failed ? (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Tool</TableHead><TableHead>Waktu</TableHead><TableHead>Durasi</TableHead><TableHead>Sesi</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.tool_name}</TableCell>
                    <TableCell className="text-muted-foreground">{formatWhen(row.started_at)}</TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{formatDuration(row.duration_ms)}</TableCell>
                    <TableCell className="max-w-48 truncate">
                      <a className="font-mono text-xs text-foreground hover:text-primary hover:underline" href={"/sessions/" + encodeURIComponent(row.session_key)}>{row.session_key}</a>
                    </TableCell>
                    <TableCell>{row.is_error ? <Badge variant="destructive">Error</Badge> : <Badge variant="secondary" className="text-primary">Berhasil</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
          {rows && rows.length > 0 ? (
            <p className="border-t border-border pt-3 text-xs text-muted-foreground" role="status">
              Menampilkan {visible.length} dari {rows.length} panggilan terakhir
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, detail, tone }: {
  label: string; value: number | null; detail: string; tone?: "positive" | "negative";
}) {
  return <div className="flex min-w-0 flex-col gap-2 border-r border-border px-3 py-5 last:border-r-0 sm:px-6 sm:py-6">
    <span className="text-[11px] leading-4 font-medium text-muted-foreground sm:text-xs">{label}</span>
    <span className={"text-[clamp(1.8rem,3vw,2.3rem)] leading-none font-semibold tracking-[-0.06em] " +
      (tone === "negative" ? "text-destructive" : tone === "positive" ? "text-primary" : "text-foreground")}>{value ?? "—"}</span>
    <span className="hidden text-xs text-muted-foreground sm:inline">{detail}</span>
  </div>;
}
