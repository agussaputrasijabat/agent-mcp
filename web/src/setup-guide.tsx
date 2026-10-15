import { useState } from "react";
import { ArrowSquareOut, CheckCircle, Info, WarningCircle } from "@phosphor-icons/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Platform = "chatgpt" | "claude";

export const setupGuides = {
  chatgpt: {
    label: "ChatGPT",
    projectUrl: "https://chatgpt.com",
    helpUrl: "https://help.openai.com/en/articles/10169521-projects-in-chatgpt",
    connectorHelpUrl: "https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt",
    steps: [
      {
        title: "Buat atau buka Project",
        description: 'Di ChatGPT, pilih "Proyek baru" pada sidebar, atau buka proyek yang sudah ada.',
      },
      {
        title: "Buka pengaturan proyek",
        description: 'Klik menu tiga titik (•••) di bagian atas proyek, lalu pilih "Pengaturan proyek" (Project settings) dan cari instruksi proyek.',
      },
      {
        title: "Tempel instruksi dari Setup",
        description: 'Pilih mode, isi Nama MCP dan Path proyek di atas, klik "Salin" pada panel Instruksi proyek, lalu tempel ke kolom instruksi ChatGPT. Simpan perubahan.',
      },
      {
        title: "Mulai chat di dalam proyek",
        description: "Buat percakapan di proyek yang sama. Pastikan konektor Agent MCP juga sudah terhubung sebelum meminta AI menjalankan tool.",
      },
    ],
  },
  claude: {
    label: "Claude",
    projectUrl: "https://claude.ai/projects",
    helpUrl: "https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects",
    connectorHelpUrl: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    steps: [
      {
        title: "Buat atau buka Project",
        description: 'Buka claude.ai/projects, lalu pilih "+ New Project" atau masuk ke proyek yang sudah ada.',
      },
      {
        title: "Cari Project instructions",
        description: 'Di area "Project knowledge" pada halaman proyek, klik "Set project instructions" (Tetapkan instruksi proyek).',
      },
      {
        title: "Tempel instruksi dari Setup",
        description: 'Pilih mode, isi Nama MCP dan Path proyek di atas, klik "Salin" pada panel Instruksi proyek, tempel teksnya, lalu klik "Save instructions".',
      },
      {
        title: "Mulai chat di dalam proyek",
        description: "Buka chat dalam proyek tersebut. Pastikan konektor Agent MCP sudah ditambahkan dan diaktifkan untuk percakapan.",
      },
    ],
  },
} as const;

export function SetupInstructionsGuide({ ready, mcpName }: { ready: boolean; mcpName: string }) {
  const [platform, setPlatform] = useState<Platform>("chatgpt");
  const guide = setupGuides[platform];

  return (
    <Card id="panduan-instruksi" className="scroll-mt-6">
      <CardHeader>
        <CardTitle><h2>Pasang instruksi di proyek AI</h2></CardTitle>
        <CardDescription>Pilih aplikasi, lalu ikuti langkah untuk menggunakan teks yang dibuat di halaman ini.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex gap-1 rounded-lg bg-muted/70 p-1" role="group" aria-label="Pilih platform panduan">
          {(["chatgpt", "claude"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={platform === item}
              onClick={() => setPlatform(item)}
              className={cn(
                "min-h-10 flex-1 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                platform === item ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {setupGuides[item].label}
            </button>
          ))}
        </div>

        <ol className="flex flex-col gap-5">
          {guide.steps.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-muted/50 font-mono text-xs font-semibold text-primary" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-sm font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/35 p-3">
          {ready ? <CheckCircle className="mt-0.5 shrink-0 text-primary" size={19} weight="bold" /> : <WarningCircle className="mt-0.5 shrink-0 text-muted-foreground" size={19} />}
          <p className="text-xs leading-5 text-muted-foreground" role="status">
            {ready
              ? <>Instruksi untuk konektor <strong className="font-semibold text-foreground">{mcpName}</strong> sudah siap disalin dari panel Instruksi proyek.</>
              : "Lengkapi Nama MCP, dan Path proyek untuk mode Coding, agar tombol Salin pada panel Instruksi proyek aktif."}
          </p>
        </div>

        <div className="flex items-start gap-2 border-t border-border pt-4">
          <Info className="mt-0.5 shrink-0 text-primary" size={18} />
          <div className="space-y-2 text-xs leading-5 text-muted-foreground">
            <p>
              <strong className="font-semibold text-foreground">Penting:</strong> Instruksi proyek hanya mengatur cara AI bekerja.
              Agar tool bisa dipanggil, hubungkan Agent MCP sebagai konektor secara terpisah di {guide.label}.
              Ketersediaan konektor bergantung pada paket dan izin akun.
            </p>
            <p>
              Isi instruksi lengkap diambil dari server lewat tool get_instructions, jadi update agent-mcp tidak perlu mengedit ulang proyek.
              Tempel ulang hanya kalau nama MCP, path, mode, atau catatan proyek berubah.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <a href={guide.projectUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                Buka {guide.label} <ArrowSquareOut size={13} />
              </a>
              <a href={guide.helpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                Panduan resmi proyek <ArrowSquareOut size={13} />
              </a>
              <a href={guide.connectorHelpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline">
                Panduan konektor MCP <ArrowSquareOut size={13} />
              </a>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
