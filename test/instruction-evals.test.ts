import { expect, test } from "bun:test";
import { compareRuns, loadSuite, makeTemplate, scoreRun, validateRun, validateSuite } from "../scripts/evaluate-instructions.ts";
import { readInstructionPack } from "../src/mcp/instructions.ts";

test("instruction behavioral suite has 20 unique, testable cases across both modes", async () => {
  const suite = await loadSuite();
  expect(suite.cases.length).toBe(20);
  expect(suite.cases.filter((c) => c.mode === "coding")).toHaveLength(12);
  expect(suite.cases.filter((c) => c.mode === "general")).toHaveLength(8);
  expect(suite.cases.every((c) => c.criteria.length >= 2 && c.setup.length > 10)).toBe(true);
  const cloned = structuredClone(suite);
  cloned.cases[1]!.id = cloned.cases[0]!.id;
  expect(() => validateSuite(cloned)).toThrow("duplicate_case_id");
});

test("both instruction packs carry verifiable outcomes while honoring length limits", () => {
  for (const mode of ["coding", "general"] as const) {
    const pack = readInstructionPack(mode);
    expect(pack.text).toContain("## Outcome and verification");
    expect(pack.text.length).toBeLessThanOrEqual(12_000);
  }
  const coding = readInstructionPack("coding").text;
  expect(coding).toContain("end-to-end");
  expect(coding).toContain("Generate → Evaluate → Repair");
  expect(coding).toContain("Never commit, push");
  const general = readInstructionPack("general").text;
  expect(general).toContain("source");
  expect(general).toContain("Before overwriting");
});

test("untested and partially graded cases never count as passes", async () => {
  const suite = await loadSuite();
  const run = makeTemplate(suite, "same-model", "baseline");
  expect(scoreRun(suite, run).passed).toBe(0);
  expect(scoreRun(suite, run).incomplete).toBe(20);
  const first = run.cases[0]!;
  first.grades[0]!.result = "pass";
  first.grades[0]!.evidence = "test/bug.test.ts passed in observed run";
  expect(scoreRun(suite, run).passed).toBe(0);
  for (const grade of first.grades) { grade.result = "pass"; grade.evidence = "Verified command output or test artifact: case 1"; }
  first.metrics = { tool_calls: 3, tokens: 4000, latency_ms: 2500 };
  const graded = scoreRun(suite, run);
  expect(graded.passed).toBe(1);
  expect(graded.incomplete).toBe(19);
  expect(graded.pass_rate).toBe(5);
  expect(graded.metrics.tokens_avg).toBe(4000);
});

test("reject unsupported cases, duplicated grades and unsupported evidence", async () => {
  const suite = await loadSuite();
  const run = makeTemplate(suite, "same-model", "baseline");
  const caseResult = run.cases[0]!;
  caseResult.grades[0]!.result = "pass";
  expect(() => validateRun(suite, run)).toThrow("missing_evidence");
  caseResult.grades[0]!.evidence = "test/a.test.ts:passed";
  caseResult.grades.push({ ...caseResult.grades[0]! });
  expect(() => validateRun(suite, run)).toThrow("duplicate_run_criterion_id");
  caseResult.grades.pop();
  run.cases.push({ id: "unknown-run-case", grades: [] });
  expect(() => validateRun(suite, run)).toThrow("unknown_case");
});

test("compare reports only observed matched regressions and improvements", async () => {
  const suite = await loadSuite();
  const baseline = makeTemplate(suite, "fixed-model", "baseline");
  const candidate = makeTemplate(suite, "fixed-model", "candidate");
  candidate.pack_versions.coding = "a".repeat(12);
  function finish(run: typeof baseline, index: number, result: "pass" | "fail") {
    for (const grade of run.cases[index]!.grades) {
      grade.result = "pass";
      grade.evidence = "Observed model trace or regression test artifact";
    }
    run.cases[index]!.grades[0]!.result = result;
  }
  finish(baseline, 0, "fail");
  finish(candidate, 0, "pass");
  finish(baseline, 1, "pass");
  finish(candidate, 1, "fail");
  const sameVersions = structuredClone(candidate);
  sameVersions.pack_versions = { ...baseline.pack_versions };
  expect(() => compareRuns(suite, baseline, sameVersions)).toThrow("identical_pack_versions");
  const report = compareRuns(suite, baseline, candidate);
  expect(report.comparable_cases).toBe(2);
  expect(report.improvements).toEqual([suite.cases[0]!.id]);
  expect(report.regressions).toEqual([suite.cases[1]!.id]);
  expect(report.ungraded_cases).toHaveLength(18);
  candidate.model = "another-model";
  expect(() => compareRuns(suite, baseline, candidate)).toThrow("different_models");
});

test("safety criterion failures remain visible in scoring reports", async () => {
  const suite = await loadSuite();
  const run = makeTemplate(suite, "fixed-model", "safety");
  const i = suite.cases.findIndex((c) => c.id === "c-secrets-in-logs");
  const row = run.cases[i]!;
  for (const grade of row.grades) {
    grade.result = "pass";
    grade.evidence = "Observed logs and files reviewed without secrets";
  }
  row.grades[0]!.result = "fail";
  const evaluated = scoreRun(suite, run);
  expect(evaluated.failed).toBe(1);
  expect(evaluated.cases[i]!.critical_failed).toContain(row.grades[0]!.id);
});

test("CLI lists cases and produces JSON templates without pretending they were graded", async () => {
  const tool = new URL("../scripts/evaluate-instructions.ts", import.meta.url).pathname;
  const result = Bun.spawnSync(["bun", tool, "template", "--model", "smoke-model", "--run-id", "smoke-id"], { cwd: process.cwd() });
  expect(result.exitCode).toBe(0);
  const template = JSON.parse(new TextDecoder().decode(result.stdout));
  expect(template.cases).toHaveLength(20);
  expect(template.cases[0].grades[0].result).toBe("not_run");
});
