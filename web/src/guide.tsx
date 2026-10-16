import { useEffect, useState, type ReactNode } from "react";
import projectStub from "../../prompts/project-stub.md?raw";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fillStub, instructionsUrl, PROJECT_INSTRUCTIONS_LIMIT, publicOrigin, type StubMode } from "./project-prompt.ts";
import { SetupInstructionsGuide } from "./setup-guide.tsx";

const projectStorageKey = "agent-mcp-setup-project-root";
const nameStorageKey = "agent-mcp-setup-mcp-name";
const modeStorageKey = "agent-mcp-setup-mode";
const notesStorageKey = "agent-mcp-setup-notes";
const stubModes: { value: StubMode; label: string; description: string }[] = [
  { value: "coding", label: "Coding", description: "Agen coding: eksplorasi repo, edit kode, tes, dan git sesuai permintaan." },
  { value: "general", label: "Non-coding", description: "Asisten kerja: dokumen, spreadsheet, PDF, riset, dan olah data." },
];
const textLink = "text-foreground underline-offset-4 hover:text-primary";

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function Guide({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle><h2>{title === "Dokumentasi" ? "Panduan penggunaan" : title}</h2></CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm leading-6">{children}</CardContent>
      </Card>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Command({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-[12px] border border-border bg-background p-3 font-mono text-xs leading-5">{children}</pre>
  );
}

export function DocsPage() {
  return (
    <Guide title="Dokumentasi">
      <Block title="Server">
        <p>
          Server ini melayani satu endpoint MCP di mesin yang menjalankan prosesnya. ChatGPT dan Claude memanggil tool di mesin itu untuk file, shell, memori, dan skill.
        </p>
        <p>
          Folder proyek menandai lokasi file. Baca dan tulis di luar folder itu boleh. Aksi berbahaya ditanyakan di chat. Model menulis perintah atau path, menunggu jawaban ya, lalu menjalankan aksi itu saja. Server menjalankan aksi itu setelah ya. Penolakan tidak terjadi di server.
        </p>
        <p>
          MCP lain tetap boleh untuk tugasnya sendiri, misalnya dokumentasi, database, atau email.
        </p>
      </Block>
      <Block title="Tool">
        <p>
          Server menyediakan tool untuk file dan folder, shell dan proses panjang, eksekusi kode, dokumen (DOCX, PDF, spreadsheet), preview file, web_fetch, memori, dan skill. Daftar lengkap beserta aturan pakainya ada di instruksi yang diambil model lewat tool get_instructions.
        </p>
        <p>
          Ada dua mode instruksi. <a className={textLink} href="/instructions/coding.md" target="_blank" rel="noopener noreferrer">Coding</a> untuk kerja di repo: eksplorasi, edit, tes, dan git.{" "}
          <a className={textLink} href="/instructions/general.md" target="_blank" rel="noopener noreferrer">Non-coding</a> untuk dokumen, spreadsheet, riset, dan olah data.
        </p>
        <p>
          URL publik dan pencarian web memakai fetch dan search bawaan ChatGPT atau Claude. web_fetch hanya dipakai kalau halaman harus diambil dari mesin MCP, misalnya fetch bawaan gagal menjangkaunya. web_fetch menolak localhost dan alamat jaringan privat; URL lokal diambil lewat shell dengan curl.
        </p>
      </Block>
      <Block title="Konsol">
        <p>
          Halaman ini untuk operator. Feed menampilkan panggilan tool. Sesi, kunci, klien, memori, skill, pengaturan, dan setup ada di menu kiri. Halaman /login tetap terbuka tanpa sesi.
        </p>
      </Block>
      <Block title="Menjalankan">
        <Step title="Siapkan .env">
          <p>
            Salin .env.example menjadi .env. Isi DASHBOARD_EMAIL, DASHBOARD_PASSWORD minimal 12 karakter, dan BETTER_AUTH_SECRET minimal 32 karakter. PUBLIC_BASE_URL adalah asal yang dipakai metadata OAuth. Bun memuat .env sendiri.
          </p>
        </Step>
        <Step title="Pasang dan jalankan">
          <p>bun install cukup sekali. bun run start membangun dashboard, lalu menjalankan proses yang sama.</p>
        </Step>
        <Step title="Laptop">
          <p>HOST=127.0.0.1 membuat proses hanya menerima koneksi di antarmuka loopback. Port tidak menerima koneksi dari antarmuka lain.</p>
          <Command>HOST=127.0.0.1 PORT=3000 PUBLIC_BASE_URL=http://127.0.0.1:3000 bun run start</Command>
        </Step>
        <Step title="Tunnel">
          <p>
            Server tetap di laptop, pada 127.0.0.1:3000. OpenAI Secure MCP Tunnel memakai tunnel-client. Klien itu membuka HTTPS keluar ke OpenAI dan meneruskan permintaan MCP ke URL lokal. Ambil tunnel_id dari pengaturan tunnel di Platform, lalu jalankan klien di mesin yang sudah bisa mencapai server.
          </p>
          <p>
            Kalau dashboard atau klien dibuka dari origin publik, set PUBLIC_BASE_URL ke origin https itu dan arahkan tunnel ke port lokal. Kalau header Host berbeda dari hostname origin itu, isi ALLOWED_HOSTS dengan hostname tersebut. Lebih dari satu hostname dipisah koma. Daftar yang sama dipakai untuk header Host dan Origin, jadi /assets dan favicon bisa dimuat tanpa sesi dashboard. TRUST_PROXY=true membuat batas percobaan login membaca IP klien dari header X-Forwarded-For.
          </p>
          <Command>tunnel-client init --profile agent-mcp --tunnel-id "$TUNNEL_ID" --mcp-server-url http://127.0.0.1:3000/mcp && tunnel-client run --profile agent-mcp</Command>
        </Step>
        <Step title="VPS">
          <p>
            Proses duduk di belakang reverse proxy. Proxy meneruskan ke 127.0.0.1. PUBLIC_BASE_URL harus https dan sama dengan nama host publik. TRUST_PROXY=true membuat batas percobaan login membaca IP klien dari header X-Forwarded-For.
          </p>
          <Command>HOST=127.0.0.1 PORT=3000 TRUST_PROXY=true PUBLIC_BASE_URL=https://mcp.example.com bun run start</Command>
          <p>
            Pemanggil tool adalah server OpenAI atau Anthropic. Cloudflare Access yang membatasi /mcp ke perangkat operator memutus panggilan itu.
          </p>
        </Step>
      </Block>
      <Block title="ChatGPT">
        <p>Di ChatGPT, tambahkan MCP kustom dengan koneksi Tunnel dan tunnel_id yang sama.</p>
        <p>
          Konektor yang minta URL server memakai origin situs ini ditambah /mcp. Alamat yang sedang terbuka ada di halaman <a className={textLink} href="/setup">Setup</a>. OAuth masuk lewat /login. Halaman /consent punya tombol Izinkan dan Tolak. Resource OAuth sama dengan PUBLIC_BASE_URL ditambah /mcp.
        </p>
        <p>
          Konektor tanpa kolom OAuth menaruh kunci di query ?api_key=. Buat kunci di halaman <a className={textLink} href="/keys">Kunci</a>. Kunci berawalan amcp_ dan hanya ditampilkan sekali. Query api_key di host publik harus lewat HTTPS. localhost dan 127.0.0.1 boleh HTTP.
        </p>
      </Block>
      <Block title="Claude">
        <p>
          Claude memakai kunci yang sama. Isi header X-Api-Key, atau Authorization Bearer dengan kunci amcp_. Query ?api_key= pada URL endpoint juga diterima. Nama yang diketik di konektor dipakai di instruksi proyek.
        </p>
      </Block>
      <Block title="Instruksi proyek">
        <p>
          Buka <a className={textLink} href="/setup">Setup</a>. Pilih mode, isi nama MCP yang sama dengan nama konektor, dan path proyek. Salin teks pendek yang dihasilkan ke custom instructions proyek di ChatGPT atau Claude.
        </p>
        <p>
          Teks itu menyuruh model memanggil get_instructions di awal tiap chat. Isi lengkapnya ikut versi server yang sedang jalan, jadi update agent-mcp tidak perlu mengedit ulang proyek. Tempel ulang hanya kalau nama MCP, path, mode, atau catatan proyek berubah.
        </p>
      </Block>
      <Block title="Kerja biasa">
        <p>
          Minta baca, edit, tes, install, git status, git diff, atau git commit di dalam folder proyek. Kerja itu langsung dijalankan.
        </p>
      </Block>
    </Guide>
  );
}

export function SetupPage() {
  const [projectRoot, setProjectRoot] = useState(() => stored(projectStorageKey));
  const [mcpName, setMcpName] = useState(() => stored(nameStorageKey));
  const [mode, setMode] = useState<StubMode>(() => (stored(modeStorageKey) === "general" ? "general" : "coding"));
  const [notes, setNotes] = useState(() => stored(notesStorageKey));
  const [version, setVersion] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const root = projectRoot.trim();
  const name = mcpName.trim();
  const ready = name.length > 0 && (mode === "general" || root.length > 0);
  const url = instructionsUrl(window.location.origin, mode);
  const fallbackUsable = publicOrigin(window.location.protocol, window.location.hostname);
  const prompt = fillStub(projectStub, {
    root: root || (mode === "coding" ? "PROJECT_ROOT" : ""),
    name: name || "MCP_NAME",
    mode,
    url: fallbackUsable ? url : "",
    notes,
  });
  const tooLong = prompt.length > PROJECT_INSTRUCTIONS_LIMIT;
  const canCopy = ready && !tooLong;
  const endpoint = `${window.location.origin}/mcp`;

  useEffect(() => {
    try {
      localStorage.setItem(projectStorageKey, projectRoot);
      localStorage.setItem(nameStorageKey, mcpName);
      localStorage.setItem(modeStorageKey, mode);
      localStorage.setItem(notesStorageKey, notes);
    } catch {
      /* storage unavailable */
    }
  }, [projectRoot, mcpName, mode, notes]);

  useEffect(() => {
    const controller = new AbortController();
    setVersion("");
    fetch(url, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setVersion(response.ok ? (response.headers.get("etag") ?? "").replaceAll("\"", "") : "");
      })
      .catch(() => {
        if (!controller.signal.aborted) setVersion("");
      });
    return () => controller.abort();
  }, [url]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function edited() {
    setCopied(false);
    setCopyFailed(false);
  }

  async function copyPrompt() {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(17rem,0.85fr)_minmax(0,1.15fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle><h2>Konfigurasi koneksi</h2></CardTitle>
            <CardDescription>Instruksi proyek hanya berisi nama konektor, folder, dan mode. Isi lengkapnya diambil dari server ini di awal tiap chat.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-3">
              <FieldSet aria-describedby="setup-mode-description">
                <FieldLegend variant="label">Mode</FieldLegend>
                <div className="flex gap-1 rounded-lg bg-muted/70 p-1">
                  {stubModes.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      aria-pressed={mode === item.value}
                      onClick={() => {
                        setMode(item.value);
                        edited();
                      }}
                      className={cn(
                        "min-h-10 flex-1 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        mode === item.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <FieldDescription id="setup-mode-description">{stubModes.find((item) => item.value === mode)?.description}</FieldDescription>
              </FieldSet>
              <Field>
                <FieldLabel htmlFor="project-root">{mode === "coding" ? "Path proyek" : "Folder kerja (opsional)"}</FieldLabel>
                <Input
                  id="project-root"
                  value={projectRoot}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setProjectRoot(event.target.value);
                    edited();
                  }}
                />
                <FieldDescription>Path absolut di mesin tempat MCP berjalan.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-name">Nama MCP</FieldLabel>
                <Input
                  id="mcp-name"
                  value={mcpName}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setMcpName(event.target.value);
                    edited();
                  }}
                />
                <FieldDescription>Nama yang diketik saat menambah konektor di ChatGPT atau Claude.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="project-notes">Catatan proyek (opsional)</FieldLabel>
                <Textarea
                  id="project-notes"
                  value={notes}
                  spellCheck={false}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    edited();
                  }}
                />
                <FieldDescription>Aturan khusus proyek ini, misalnya perintah tes atau gaya penulisan. Ikut ditempel ke instruksi proyek.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-endpoint">Endpoint</FieldLabel>
                <Input id="mcp-endpoint" readOnly value={endpoint} spellCheck={false} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <SetupInstructionsGuide ready={canCopy} mcpName={name} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle><h2>Instruksi proyek</h2></CardTitle>
          <CardDescription>
            {canCopy
              ? "Teks ini siap ditempel ke custom instructions proyek. Update agent-mcp tidak perlu tempel ulang."
              : tooLong
                ? "Teks terlalu panjang untuk ChatGPT. Pendekkan catatan proyek."
                : mode === "coding"
                ? "Isi path proyek dan nama MCP. Selama salah satu kosong, teks di bawah masih memakai placeholder."
                : "Isi nama MCP. Selama kosong, teks di bawah masih memakai placeholder."}
          </CardDescription>
          {ready ? (
            <CardAction>
              <Button type="button" disabled={tooLong} aria-describedby="setup-length" onClick={() => void copyPrompt()}>{copied ? "Tersalin" : "Salin"}</Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {copyFailed ? <p className="text-destructive">Gagal menyalin. Pilih teksnya, lalu salin dari situ.</p> : null}
          <pre
            aria-label={ready ? "Instruksi proyek" : "Struktur instruksi, placeholder belum diganti"}
            className="overflow-x-auto whitespace-pre-wrap break-words rounded-[12px] border border-border bg-background p-3 font-mono text-xs leading-5"
          >
            {prompt}
          </pre>
          <p id="setup-length" className={cn("text-xs", tooLong ? "text-destructive" : "text-muted-foreground")}>
            {prompt.length.toLocaleString("id-ID")} / {PROJECT_INSTRUCTIONS_LIMIT.toLocaleString("id-ID")} karakter
            {tooLong ? ". Batas ChatGPT terlewati, pendekkan catatan proyek." : null}
          </p>
          {tooLong ? <p className="sr-only" role="alert">Instruksi melewati batas 8.000 karakter. Tombol Salin dinonaktifkan.</p> : null}
          <p className="text-xs text-muted-foreground">
            Instruksi lengkap mode ini: <a className={textLink} href={url} target="_blank" rel="noopener noreferrer">{url}</a>
            {version ? <> (versi <code className="font-mono">{version}</code>)</> : null}
          </p>
          {fallbackUsable ? null : (
            <p className="text-xs text-muted-foreground">
              Halaman ini dibuka lewat alamat lokal, jaringan privat, atau tanpa HTTPS, jadi URL cadangan tidak dimasukkan ke instruksi. ChatGPT dan Claude tidak bisa membuka alamat itu. Tool get_instructions tetap jalan lewat konektor. Buka Setup dari origin HTTPS publik kalau ingin URL cadangan ikut disertakan.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
