import * as z from "zod/v4";
import { readInstructionPack } from "../src/mcp/instructions.ts";

const modeSchema = z.enum(["coding", "general"]);
const criterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  critical: z.boolean(),
}).strict();
const suiteSchema = z.object({
  version: z.literal(1),
  description: z.string().min(1),
  cases: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]+$/),
    mode: modeSchema,
    category: z.string().min(1),
    setup: z.string().min(1),
    prompt: z.string().min(1),
    criteria: z.array(criterionSchema).min(2),
  }).strict()).min(1),
}).strict();
const gradeSchema = z.object({
  id: z.string().min(1),
  result: z.enum(["pass", "fail", "not_run"]),
  evidence: z.string().default(""),
}).strict();
const metricsSchema = z.object({
  tool_calls: z.number().int().nonnegative().optional(),
  tokens: z.number().int().nonnegative().optional(),
  latency_ms: z.number().nonnegative().optional(),
}).strict();
const runSchema = z.object({
  run_id: z.string().min(1),
  model: z.string().min(1),
  pack_versions: z.object({
    coding: z.string().regex(/^[0-9a-f]{12}$/),
    general: z.string().regex(/^[0-9a-f]{12}$/),
  }).strict(),
  cases: z.array(z.object({
    id: z.string().min(1),
    grades: z.array(gradeSchema),
    metrics: metricsSchema.optional(),
  }).strict()),
}).strict();

export type EvalSuite = z.infer<typeof suiteSchema>;
export type EvalRun = z.infer<typeof runSchema>;
export type EvalMode = z.infer<typeof modeSchema>;
type CaseStatus = "pass" | "fail" | "incomplete";
type ScoredCase = { id: string; mode: EvalMode; status: CaseStatus; failed: string[]; missing: string[]; critical_failed: string[] };
type Score = {
  run_id: string;
  model: string;
  pack_versions: EvalRun["pack_versions"];
  total: number;
  passed: number;
  failed: number;
  incomplete: number;
  pass_rate: number;
  metrics: {
    tool_calls_avg: number | null;
    tokens_avg: number | null;
    latency_ms_avg: number | null;
    measured_cases: number;
  };
  cases: ScoredCase[];
};

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`duplicate_${label}`);
}
export function validateSuite(input: unknown): EvalSuite {
  const suite = suiteSchema.parse(input);
  unique(suite.cases.map((c) => c.id), "case_id");
  for (const c of suite.cases) unique(c.criteria.map((check) => check.id), `criterion_id:${c.id}`);
  return suite;
}
export function validateRun(suite: EvalSuite, input: unknown): EvalRun {
  const run = runSchema.parse(input);
  const validIds = new Set(suite.cases.map((c) => c.id));
  unique(run.cases.map((c) => c.id), "run_case_id");
  for (const result of run.cases) {
    if (!validIds.has(result.id)) throw new Error(`unknown_case:${result.id}`);
    const spec = suite.cases.find((c) => c.id === result.id)!;
    const validCriteria = new Set(spec.criteria.map((criterion) => criterion.id));
    unique(result.grades.map((g) => g.id), `run_criterion_id:${result.id}`);
    for (const grade of result.grades) {
      if (!validCriteria.has(grade.id)) throw new Error(`unknown_criterion:${result.id}:${grade.id}`);
      if (grade.result !== "not_run" && grade.evidence.trim().length < 8) {
        throw new Error(`missing_evidence:${result.id}:${grade.id}`);
      }
    }
  }
  return run;
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100;
}
export function scoreRun(suiteInput: unknown, runInput: unknown, mode?: EvalMode): Score {
  const suite = validateSuite(suiteInput);
  const run = validateRun(suite, runInput);
  const rows = new Map(run.cases.map((c) => [c.id, c]));
  const selected = suite.cases.filter((c) => !mode || c.mode === mode);
  const scored: ScoredCase[] = selected.map((c) => {
    const grades = new Map(rows.get(c.id)?.grades.map((g) => [g.id, g]) ?? []);
    const failed = c.criteria.filter((check) => grades.get(check.id)?.result === "fail").map((check) => check.id);
    const missing = c.criteria.filter((check) => !grades.has(check.id) || grades.get(check.id)?.result === "not_run").map((check) => check.id);
    const critical_failed = c.criteria.filter((check) => check.critical && failed.includes(check.id)).map((check) => check.id);
    return {
      id: c.id, mode: c.mode,
      status: failed.length ? "fail" : missing.length ? "incomplete" : "pass",
      failed, missing, critical_failed,
    };
  });
  const completed = selected.map((c) => rows.get(c.id)).filter((r): r is NonNullable<typeof r> => !!r?.metrics);
  const passed = scored.filter((c) => c.status === "pass").length;
  return {
    run_id: run.run_id, model: run.model, pack_versions: run.pack_versions,
    total: scored.length, passed,
    failed: scored.filter((c) => c.status === "fail").length,
    incomplete: scored.filter((c) => c.status === "incomplete").length,
    pass_rate: scored.length ? Math.round(passed * 10_000 / scored.length) / 100 : 0,
    metrics: {
      tool_calls_avg: average(completed.flatMap((x) => x.metrics?.tool_calls === undefined ? [] : [x.metrics.tool_calls])),
      tokens_avg: average(completed.flatMap((x) => x.metrics?.tokens === undefined ? [] : [x.metrics.tokens])),
      latency_ms_avg: average(completed.flatMap((x) => x.metrics?.latency_ms === undefined ? [] : [x.metrics.latency_ms])),
      measured_cases: completed.length,
    },
    cases: scored,
  };
}
export function compareRuns(suite: unknown, baseline: unknown, candidate: unknown, mode?: EvalMode) {
  const before = scoreRun(suite, baseline, mode);
  const after = scoreRun(suite, candidate, mode);
  if (before.model !== after.model) throw new Error("different_models: keep the model fixed to isolate instruction changes");
  if (before.pack_versions.coding === after.pack_versions.coding && before.pack_versions.general === after.pack_versions.general) {
    throw new Error("identical_pack_versions: baseline and candidate must represent different instruction packs");
  }
  const old = new Map(before.cases.map((c) => [c.id, c.status]));
  const matched = after.cases.filter((c) => old.get(c.id) !== "incomplete" && c.status !== "incomplete");
  return {
    model: before.model,
    baseline: { run_id: before.run_id, versions: before.pack_versions, passed: before.passed, total: before.total, incomplete: before.incomplete, pass_rate: before.pass_rate, metrics: before.metrics },
    candidate: { run_id: after.run_id, versions: after.pack_versions, passed: after.passed, total: after.total, incomplete: after.incomplete, pass_rate: after.pass_rate, metrics: after.metrics },
    comparable_cases: matched.length,
    improvements: matched.filter((c) => old.get(c.id) === "fail" && c.status === "pass").map((c) => c.id),
    regressions: matched.filter((c) => old.get(c.id) === "pass" && c.status === "fail").map((c) => c.id),
    ungraded_cases: after.cases.filter((c) => old.get(c.id) === "incomplete" || c.status === "incomplete").map((c) => c.id),
    note: "Scores summarize human-verified evidence recorded after real agent runs; the scorer cannot independently confirm evidence or execute models.",
  };
}
export function makeTemplate(suiteInput: unknown, model: string, runId: string): EvalRun {
  const suite = validateSuite(suiteInput);
  return {
    run_id: runId, model,
    pack_versions: { coding: readInstructionPack("coding").version, general: readInstructionPack("general").version },
    cases: suite.cases.map((c) => ({
      id: c.id,
      grades: c.criteria.map((check) => ({ id: check.id, result: "not_run" as const, evidence: "" })),
    })),
  };
}
export async function loadSuite(): Promise<EvalSuite> {
  return validateSuite(JSON.parse(await Bun.file(new URL("../evals/instructions/cases.json", import.meta.url)).text()));
}

function option(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}
function usage(): never {
  throw new Error("Usage: bun scripts/evaluate-instructions.ts list|template|score|compare [--mode coding|general] [--model MODEL --run-id ID] [--run file.json] [--baseline file.json --candidate file.json]");
}
if (import.meta.main) {
  try {
    const [command, ...args] = Bun.argv.slice(2);
    const suite = await loadSuite();
    const modeName = option(args, "--mode");
    if (modeName && modeName !== "coding" && modeName !== "general") usage();
    const mode = modeName as EvalMode | undefined;
    if (command === "list") {
      console.log(JSON.stringify(suite.cases.filter((c) => !mode || c.mode === mode), null, 2));
    } else if (command === "template") {
      const model = option(args, "--model");
      const id = option(args, "--run-id");
      if (!model || !id) usage();
      const template = makeTemplate(suite, model, id);
      for (const packMode of ["coding", "general"] as const) {
        const override = option(args, `--${packMode}-version`);
        if (override) {
          if (!/^[0-9a-f]{12}$/.test(override)) throw new Error(`invalid_${packMode}_version`);
          template.pack_versions[packMode] = override;
        }
      }
      if (mode) template.cases = template.cases.filter((c) => suite.cases.find((x) => x.id === c.id)?.mode === mode);
      console.log(JSON.stringify(template, null, 2));
    } else if (command === "score") {
      const file = option(args, "--run");
      if (!file) usage();
      console.log(JSON.stringify(scoreRun(suite, JSON.parse(await Bun.file(file).text()), mode), null, 2));
    } else if (command === "compare") {
      const baselineFile = option(args, "--baseline");
      const candidateFile = option(args, "--candidate");
      if (!baselineFile || !candidateFile) usage();
      const result = compareRuns(suite, JSON.parse(await Bun.file(baselineFile).text()), JSON.parse(await Bun.file(candidateFile).text()), mode);
      console.log(JSON.stringify(result, null, 2));
      if (result.regressions.length) process.exitCode = 1;
    } else usage();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
