import { useEffect, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { api } from "./api.ts";
import { EmptyState, LoadingRows, Shell, formatWhen } from "./shell.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type CallRow = {
  id: string;
  tool_name: string;
  started_at: string;
  session_key: string;
  is_error: number;
};

export function FeedPage() {
  const [query, setQuery] = useState("");
  return (
    <Shell
      toolbar={
        <InputGroup className="max-w-xs">
          <InputGroupAddon>
            <MagnifyingGlass />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari tool atau sesi"
            aria-label="Cari tool atau sesi"
          />
        </InputGroup>
      }
    >
      <FeedBody query={query} />
    </Shell>
  );
}

function FeedBody({ query }: { query: string }) {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  function load(showSkeleton: boolean) {
    if (showSkeleton) {
      setFailed(false);
      setRows(null);
    }
    return api<{ items: CallRow[] }>("/api/tool-calls?limit=50").then((result) => {
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setRows(result.data.items);
    });
  }

  useEffect(() => {
    void load(true);
    const timer = setInterval(() => void load(false), 1000);
    return () => clearInterval(timer);
  }, []);

  const needle = query.trim().toLowerCase();
  const visible = (rows ?? []).filter((row) => {
    if (!needle) return true;
    return row.tool_name.toLowerCase().includes(needle) || row.session_key.toLowerCase().includes(needle);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle><h1>Feed</h1></CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {failed ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground">Feed gagal dimuat.</p>
            <Button type="button" onClick={() => void load(true)}>Coba lagi</Button>
          </div>
        ) : null}
        {rows === null && !failed ? <LoadingRows /> : null}
        {rows?.length === 0 && !failed ? <EmptyState>Belum ada panggilan tool.</EmptyState> : null}
        {rows && rows.length > 0 && visible.length === 0 && !failed ? <p className="text-muted-foreground">Tidak ada baris yang cocok.</p> : null}
        {rows && rows.length > 0 && visible.length > 0 && !failed ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Waktu</TableHead>
                <TableHead>Sesi</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.tool_name}</TableCell>
                  <TableCell>{formatWhen(row.started_at)}</TableCell>
                  <TableCell className="max-w-56 truncate">
                    <a className="text-foreground underline-offset-4 hover:text-primary" href={`/sessions/${encodeURIComponent(row.session_key)}`}>
                      {row.session_key}
                    </a>
                  </TableCell>
                  <TableCell>
                    {row.is_error ? <Badge variant="destructive">error</Badge> : <Badge>ok</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
