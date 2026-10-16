import { useEffect, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, CheckCircle, Desktop, HardDrives, ShieldCheck, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "./api.ts";
import { Failed, LoadingRows } from "./shell.tsx";

type Settings = {
  driver_observe: boolean;
  driver_control: boolean;
  sandbox_observe: boolean;
  sandbox_manage: boolean;
};
type Runtime = { installed: boolean; compatible: boolean; version: string | null };
type State = { settings: Settings; runtimes: { driver: Runtime; sandbox: Runtime } };

export function ComputerPage() {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setError("");
    const response = await api<State>("/api/computer");
    if (response.ok) setData(response.data);
    else setError(response.message);
    setLoading(false);
  }

  useEffect(() => { void refresh(); }, []);

  async function toggle(field: keyof Settings) {
    if (!data || saving) return;
    const enabling = !data.settings[field];
    if (enabling && (field === "driver_control" || field === "sandbox_manage")) {
      const scope = field === "driver_control" ? "aplikasi di desktop host" : "sandbox lokal";
      if (!window.confirm(`Aktifkan kontrol terhadap ${scope}? Agent terautentikasi dapat melakukan tindakan nyata. Lanjutkan?`)) return;
    }
    const next = { ...data.settings, [field]: enabling };
    if (field === "driver_observe" && !enabling) next.driver_control = false;
    if (field === "sandbox_observe" && !enabling) next.sandbox_manage = false;
    if (field === "driver_control" && enabling) next.driver_observe = true;
    if (field === "sandbox_manage" && enabling) next.sandbox_observe = true;
    setSaving(true);
    setError("");
    setNotice("");
    const response = await api<State>("/api/computer", {
      method: "PATCH",
      headers: { "x-agent-mcp-action": "computer-settings" },
      body: JSON.stringify(next),
    });
    if (response.ok) {
      setData(response.data);
      setNotice("Akses diperbarui. Permintaan MCP berikutnya langsung mengikuti izin baru.");
    } else setError(response.message);
    setSaving(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="relative isolate overflow-hidden rounded-2xl border border-border bg-card px-6 py-8 sm:px-9 sm:py-10">
        <div className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-primary/10 blur-[90px]" />
        <div className="relative grid items-center gap-7 lg:grid-cols-[minmax(0,1.65fr)_minmax(17rem,1fr)]">
          <div className="max-w-5xl">
            <p className="mb-3 text-xs font-semibold tracking-[0.13em] uppercase text-muted-foreground">Remote desktop automation</p>
            <h2 className="max-w-5xl text-[clamp(1.9rem,3.5vw,3rem)] font-semibold leading-[1.12] tracking-[-0.05em]">Satu agent, dua lingkungan kerja.</h2>
            <p className="mt-4 max-w-[64ch] text-sm leading-7 text-muted-foreground sm:text-[15px]">
              Gunakan Cua Driver untuk aplikasi di komputer ini atau Cua untuk sandbox lokal.
              Akses keduanya terpisah dan dinonaktifkan sampai kamu mengizinkannya.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background/75 p-5">
            <div className="flex items-center gap-3 text-sm font-semibold"><ShieldCheck size={23} className="text-primary" /> Kendali tetap di tangan operator</div>
            <p className="text-xs leading-6 text-muted-foreground">Aksi window, session, dan sandbox melewati kebijakan Agent MCP. Akses desktop penuh, shell Cua, dan cloud provisioning tidak diekspos.</p>
            <Button variant="outline" size="sm" className="w-fit gap-2" onClick={() => void refresh()} disabled={loading || saving}>
              <ArrowClockwise size={16} /> Periksa ulang
            </Button>
          </div>
        </div>
      </section>

      {error ? <div className="flex items-start gap-2 rounded-lg border border-destructive/30 p-4 text-sm text-destructive" role="alert"><WarningCircle size={19} className="shrink-0" />{error}</div> : null}
      {notice ? <p className="flex items-center gap-2 text-sm text-primary" role="status"><CheckCircle size={19} />{notice}</p> : null}
      {loading && !data ? <LoadingRows /> : null}
      {!data && !loading ? <Failed onRetry={() => void refresh()} /> : null}

      {data ? <div className="grid gap-4 lg:grid-cols-2">
        <RuntimePanel
          icon={<Desktop size={24} />}
          title="Host computer"
          subtitle="Cua Driver"
          runtime={data.runtimes.driver}
          observe={data.settings.driver_observe}
          control={data.settings.driver_control}
          observeLabel="Izinkan observasi window"
          controlLabel="Izinkan kontrol mouse dan keyboard"
          disabled={saving}
          onObserve={() => void toggle("driver_observe")}
          onControl={() => void toggle("driver_control")}
          description="Membaca aplikasi, accessibility tree, dan screenshot window; kontrol hanya menerima target window yang spesifik."
          install="cua-driver --version"
        />
        <RuntimePanel
          icon={<HardDrives size={24} />}
          title="Isolated sandboxes"
          subtitle="Cua CLI"
          runtime={data.runtimes.sandbox}
          observe={data.settings.sandbox_observe}
          control={data.settings.sandbox_manage}
          observeLabel="Izinkan discovery sandbox lokal"
          controlLabel="Izinkan pengelolaan dan interaksi"
          disabled={saving}
          onObserve={() => void toggle("sandbox_observe")}
          onControl={() => void toggle("sandbox_manage")}
          description="Lingkungan Linux container lokal. Membatasi pembuatan, lifecycle, dan interaksi; tidak mengakses cloud atau host shell."
          install="cua --version"
        />
      </div> : null}

      <Card className="overflow-hidden">
        <CardContent className="grid gap-6 p-6 md:grid-cols-[minmax(0,1fr)_minmax(15rem,.8fr)] md:p-7">
          <div>
            <h3 className="text-base font-semibold tracking-tight">Sebelum mengaktifkan akses</h3>
            <p className="mt-2 max-w-[65ch] text-sm leading-7 text-muted-foreground">Pastikan Cua Driver berjalan dengan permission mode <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">bounded</code> dan capability manifest yang hanya memperbolehkan aplikasi yang kamu pilih. Di macOS, jalankan daemon melalui CuaDriver.app agar izin Accessibility dan Screen Recording teratribusi dengan benar.</p>
            <a className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" href="https://cua.ai/docs/cua-driver/guides/permissions" target="_blank" rel="noopener noreferrer">
              Panduan permissions resmi <ArrowSquareOut size={16} />
            </a>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Terminal</p>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs leading-7 text-foreground">{`cua-driver doctor --json
cua-driver permissions status
agent-mcp computer doctor`}</pre>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Diagnostik tidak otomatis memberi izin, menjalankan daemon, atau memasang paket.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RuntimePanel(props: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  runtime: Runtime;
  observe: boolean;
  control: boolean;
  observeLabel: string;
  controlLabel: string;
  disabled: boolean;
  description: string;
  install: string;
  onObserve: () => void;
  onControl: () => void;
}) {
  return <article className="group flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 transition-shadow duration-300 hover:shadow-lg motion-reduce:transition-none sm:p-7">
    <div className="flex items-start gap-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-105 motion-reduce:transform-none">{props.icon}</div>
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-semibold tracking-tight">{props.title}</h3>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{props.subtitle}</p>
      </div>
      <span className={`mt-1 flex items-center gap-2 text-xs font-medium ${props.runtime.installed ? "text-primary" : "text-muted-foreground"}`}>
        <span className={`size-2 rounded-full ${props.runtime.installed ? "bg-primary" : "bg-muted-foreground/60"}`} aria-hidden="true" />
        {props.runtime.compatible ? "Terdeteksi" : props.runtime.installed ? "Perlu update" : "Belum terpasang"}
      </span>
    </div>
    <p className="min-h-12 text-sm leading-6 text-muted-foreground">{props.description}</p>
    <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-xs">
      <span className="text-muted-foreground">Versi runtime</span>
      <p className="mt-1 break-all font-mono text-foreground">{props.runtime.version || `Belum tersedia · ${props.install}`}</p>
    </div>
    <div className="mt-auto space-y-3 border-t border-border pt-5">
      <AccessSwitch label={props.observeLabel} enabled={props.observe} disabled={props.disabled || (!props.runtime.compatible && !props.observe)} onClick={props.onObserve} />
      <AccessSwitch label={props.controlLabel} enabled={props.control} disabled={props.disabled || (!props.runtime.compatible && !props.control)} onClick={props.onControl} />
    </div>
  </article>;
}

function AccessSwitch({ label, enabled, disabled, onClick }: { label: string; enabled: boolean; disabled: boolean; onClick: () => void }) {
  return <div className="flex items-center justify-between gap-4">
    <span className="text-sm leading-6 text-foreground">{label}</span>
    <button type="button" role="switch" aria-checked={enabled} aria-label={label} disabled={disabled} onClick={onClick}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${enabled ? "border-primary bg-primary" : "border-border bg-muted-foreground/25"}`}>
      <span className={`absolute left-1 top-1 size-[18px] rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none ${enabled ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  </div>;
}
