import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { Failed, LoadingRows, formatDuration, formatWhen } from "./shell.tsx";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SessionRow = {
  session_key: string;
  last_started_at: string;
  call_count: number;
  error_count: number;
  last_tool_name: string;
};

type CallRow = {
  id: string;
  tool_name: string;
  started_at: string;
  duration_ms: number | null;
  is_error: number;
};

export function SessionsPage() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  function load() {
    setFailed(false);
    setRows(null);
    api<{ items: SessionRow[] }>("/api/sessions?limit=50").then((result) => {
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setRows(result.data.items);
    });
  }

  useEffect(load, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Daftar sesi</h2></CardTitle>
      </CardHeader>
      <CardContent>
        {failed ? <Failed onRetry={load} /> : null}
        {rows === null && !failed ? <LoadingRows /> : null}
        {rows && rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sesi</TableHead>
                <TableHead>Terakhir</TableHead>
                <TableHead>Panggilan</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Tool</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.session_key}>
                  <TableCell className="max-w-56 truncate">
                    <a className="text-foreground underline-offset-4 hover:text-primary" href={`/sessions/${encodeURIComponent(row.session_key)}`}>
                      {row.session_key}
                    </a>
                  </TableCell>
                  <TableCell>{formatWhen(row.last_started_at)}</TableCell>
                  <TableCell>{row.call_count}</TableCell>
                  <TableCell>{row.error_count}</TableCell>
                  <TableCell>{row.last_tool_name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SessionDetailPage({ sessionKey }: { sessionKey: string }) {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  function load() {
    setFailed(false);
    setRows(null);
    api<{ items: CallRow[] }>(`/api/tool-calls?limit=100&session_key=${encodeURIComponent(sessionKey)}`).then((result) => {
      if (!result.ok) {
        setFailed(true);
        return;
      }
      setRows(result.data.items);
    });
  }

  useEffect(load, [sessionKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle><h2 className="truncate font-mono text-sm" title={sessionKey}>{sessionKey}</h2></CardTitle>
      </CardHeader>
      <CardContent>
        {failed ? <Failed onRetry={load} /> : null}
        {rows === null && !failed ? <LoadingRows /> : null}
        {rows?.length === 0 ? <p className="text-muted-foreground">Sesi ini tidak punya panggilan.</p> : null}
        {rows && rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Waktu</TableHead>
                <TableHead>Durasi</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.tool_name}</TableCell>
                  <TableCell>{formatWhen(row.started_at)}</TableCell>
                  <TableCell className="tabular-nums">{formatDuration(row.duration_ms)}</TableCell>
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
