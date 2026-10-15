import { useEffect, useState } from "react";
import { ShieldCheck, ArrowClockwise } from "@phosphor-icons/react";
import { api } from "./api.ts";
import { EmptyState, LoadingRows, formatWhen } from "./shell.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type Approval = {
  id: string;
  tool_name: string;
  reason: string;
  summary: string;
  preview: string | null;
  auth_kind: string;
  auth_subject: string;
  created_at: string;
  expires_at: string;
  status: "pending" | "approved" | "denied";
  used_at: string | null;
};

export function ApprovalsPage() {
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function reload() {
    const result = await api<{ items: Approval[] }>("/api/approvals");
    if (result.ok) setRows(result.data.items);
    else setMessage(result.message);
  }

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  async function decide(row: Approval, decision: "approved" | "denied") {
    if (decision === "approved" && !window.confirm("Izinkan tindakan ini dilakukan satu kali oleh klien pemohon?")) return;
    setBusy(row.id);
    setMessage("");
    const result = await api<{ ok: boolean }>(`/api/approvals/${encodeURIComponent(row.id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    });
    if (!result.ok) setMessage(result.message);
    setBusy(null);
    await reload();
  }

  const pending = rows?.filter((row) => row.status === "pending" && Date.parse(row.expires_at) > Date.now()) ?? [];
  const history = rows?.filter((row) => !pending.includes(row)).slice(0, 15) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck size={20} /> Persetujuan eksekusi</CardTitle>
          <CardDescription>
            Periksa perintah dan identitas klien. Approval berlaku sekali, hanya untuk argumen yang sama, dan kedaluwarsa dalam lima menit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">{pending.length} permintaan menunggu keputusan</p>
            <Button size="sm" variant="outline" onClick={() => void reload()}><ArrowClockwise size={16} /> Perbarui</Button>
          </div>
          {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
          {rows === null ? <LoadingRows /> : pending.length === 0 ? <EmptyState>Tidak ada permintaan approval aktif.</EmptyState> : null}
          {pending.map((row) => (
            <div key={row.id} className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{row.tool_name}</Badge>
                <span className="text-sm font-medium">{row.reason}</span>
                <span className="text-xs text-muted-foreground">{formatWhen(row.created_at)}</span>
              </div>
              <pre className="whitespace-pre-wrap break-all rounded-md bg-muted/60 p-3 font-mono text-xs max-h-48 overflow-auto">{row.preview ?? `${row.summary}\nPreview tidak tersedia setelah server restart. Tolak dan minta agen mengirim permintaan baru.`}</pre>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Klien: {row.auth_kind} / {row.auth_subject.slice(0, 12)}… · ID {row.id}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(row, "denied")}>Tolak</Button>
                  <Button size="sm" disabled={busy !== null || !row.preview} onClick={() => void decide(row, "approved")}>Izinkan sekali</Button>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {history.length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Riwayat keputusan</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {history.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-b-0">
                <span className="text-sm font-medium">{row.tool_name} · {row.reason}</span>
                <span className="text-xs text-muted-foreground">
                  {row.status === "pending" ? "Kedaluwarsa" : row.status === "approved" ? row.used_at ? "Dijalankan" : "Disetujui" : "Ditolak"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
