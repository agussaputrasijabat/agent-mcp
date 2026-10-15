import { useEffect, useState, type ReactNode } from "react";
import projectInstructions from "../../prompts/project-instructions.md?raw";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { chatInstructions, fillProjectPrompt } from "./project-prompt.ts";
import { SetupInstructionsGuide } from "./setup-guide.tsx";

const chatSection = chatInstructions(projectInstructions);
const projectStorageKey = "agent-mcp-setup-project-root";
const nameStorageKey = "agent-mcp-setup-mcp-name";
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
        <ul className="list-disc pl-5">
          <li>read_file membaca file.</li>
          <li>write_file membuat file atau menimpa seluruh isi.</li>
          <li>edit_file mengubah sebagian file.</li>
          <li>glob mencari path.</li>
          <li>grep mencari isi file.</li>
          <li>shell menjalankan perintah, git, tes, dan install.</li>
          <li>web_fetch mengambil URL dari mesin MCP. URL publik memakai fetch atau browse bawaan ChatGPT atau Claude dulu. web_fetch untuk localhost, jaringan privat, atau saat fetch bawaan tidak menjangkau URL itu.</li>
          <li>memory_search, memory_save, dan memory_forget menyimpan catatan antar chat.</li>
          <li>skill_list, skill_read, skill_save, dan skill_delete menyimpan prosedur tetap.</li>
        </ul>
        <p>Pencarian web memakai fitur bawaan ChatGPT atau Claude. Tool web_search tidak ada di server ini.</p>
        <p>
          Jika pengguna minta rencana, model memanggil skill_read untuk skill bawaan bernama plan, lalu mengikuti skill itu. Pertanyaan, pilihan, dan rencana tetap di chat klien.
        </p>
        <p>
          Berkas instruksi user dan global dicari di direktori home, ~/.claude, ~/.codex, dan ~/.cursor. Setelah itu berkas di folder yang sedang disentuh, naik sampai akar proyek. Berkas yang lebih dalam menang. Berkas proyek menang atas berkas user. Instruksi di chat menang atas semua berkas.
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
          Buka <a className={textLink} href="/setup">Setup</a>. Isi path absolut proyek di mesin MCP, dan nama MCP yang sama dengan nama di konektor. Setelah keduanya terisi, salin teks yang dihasilkan. Tempel ke custom instructions proyek di ChatGPT atau Claude.
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
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const root = projectRoot.trim();
  const name = mcpName.trim();
  const ready = root.length > 0 && name.length > 0;
  const prompt = ready ? fillProjectPrompt(chatSection, root, name) : chatSection;
  const endpoint = `${window.location.origin}/mcp`;

  useEffect(() => {
    try {
      localStorage.setItem(projectStorageKey, projectRoot);
      localStorage.setItem(nameStorageKey, mcpName);
    } catch {
      /* storage unavailable */
    }
  }, [projectRoot, mcpName]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function editRoot(value: string) {
    setProjectRoot(value);
    setCopied(false);
    setCopyFailed(false);
  }

  function editName(value: string) {
    setMcpName(value);
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
            <CardDescription>Path proyek dan nama konektor mengganti placeholder di instruksi. Endpoint mengikuti origin halaman ini.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="gap-3">
              <Field>
                <FieldLabel htmlFor="project-root">Path proyek</FieldLabel>
                <Input
                  id="project-root"
                  value={projectRoot}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => editRoot(event.target.value)}
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
                  onChange={(event) => editName(event.target.value)}
                />
                <FieldDescription>Nama yang diketik saat menambah konektor di ChatGPT atau Claude.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="mcp-endpoint">Endpoint</FieldLabel>
                <Input id="mcp-endpoint" readOnly value={endpoint} spellCheck={false} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <SetupInstructionsGuide ready={ready} mcpName={name} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle><h2>Instruksi proyek</h2></CardTitle>
          <CardDescription>
            {ready
              ? "Teks ini siap ditempel ke custom instructions proyek."
              : "Isi path proyek dan nama MCP. Selama salah satu kosong, teks di bawah masih memakai PROJECT_ROOT dan MCP_NAME."}
          </CardDescription>
          {ready ? (
            <CardAction>
              <Button type="button" onClick={() => void copyPrompt()}>{copied ? "Tersalin" : "Salin"}</Button>
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
        </CardContent>
      </Card>
    </div>
  );
}
