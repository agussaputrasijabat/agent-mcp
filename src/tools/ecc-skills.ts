import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidName } from "./names.ts";

const DESCRIPTION_LIMIT = 200;
const BODY_LIMIT = 32_000;

const intro = [
  "Sumber: ECC agents. MIT. Copyright (c) 2026 Affaan Mustafa.",
  "",
  "Pakai skill ini untuk review. Laporkan temuan. Jangan mengubah kode.",
  "",
  "Tool di mesin ini: Read = read_file, Grep = grep, Glob = glob, Bash = shell. Jika teks di bawah menyebut skill atau agent lain, baca lewat skill_read. Abaikan slash command dan Task.",
].join("\n");

export const eccSkillNames = [
  "agent-evaluator",
  "bengali-reviewer",
  "code-reviewer",
  "comment-analyzer",
  "commit-reviewer",
  "conversation-analyzer",
  "cpp-reviewer",
  "csharp-reviewer",
  "database-reviewer",
  "django-reviewer",
  "fastapi-reviewer",
  "flutter-reviewer",
  "fsharp-reviewer",
  "go-reviewer",
  "healthcare-reviewer",
  "java-reviewer",
  "kotlin-reviewer",
  "mle-reviewer",
  "network-config-reviewer",
  "php-reviewer",
  "pr-test-analyzer",
  "python-reviewer",
  "rag-pipeline-reviewer",
  "react-reviewer",
  "ruby-reviewer",
  "rust-reviewer",
  "security-reviewer",
  "silent-failure-hunter",
  "swift-reviewer",
  "type-design-analyzer",
  "typescript-reviewer",
  "vue-reviewer",
] as const;

const descriptionOverrides: Partial<Record<(typeof eccSkillNames)[number], string>> = {
  "agent-evaluator":
    "Evaluates agent output on accuracy, completeness, clarity, actionability, and conciseness. Use when the user wants a quality assessment of agent output.",
  "bengali-reviewer":
    "Reviews Bengali (Bangla) text for Unicode, normalization, script-aware processing, and i18n. Use when code processes, displays, or stores Bengali text.",
  "database-reviewer":
    "PostgreSQL reviewer for query optimization, schema design, security, and performance. Use when writing SQL, migrations, schemas, or debugging database performance.",
  "django-reviewer":
    "Django reviewer for ORM, DRF, migration safety, security, and production practices. Use for all Django changes. MUST BE USED for Django projects.",
  "flutter-reviewer":
    "Flutter and Dart reviewer for widgets, state management, Dart idioms, performance, accessibility, and clean architecture. Use for Flutter code.",
  "java-reviewer":
    "Java reviewer for Spring Boot and Quarkus: layered architecture, JPA/Panache, MongoDB, security, and concurrency. MUST BE USED for all Java changes.",
  "mle-reviewer":
    "ML engineering reviewer for data contracts, feature pipelines, training, evaluation, serving, monitoring, and rollback. Use when ML or MLOps code changes.",
  "rag-pipeline-reviewer":
    "Reviews RAG pipelines for retrieval quality, chunking, embeddings, and evaluation. Use when building or debugging RAG, vector stores, or retrieval.",
  "react-reviewer":
    "React/JSX reviewer for hooks, render performance, server/client boundaries, accessibility, and React security. MUST BE USED for React projects.",
  "ruby-reviewer":
    "Ruby and Rails reviewer for idiomatic Ruby, Active Record safety, Rails security, and test quality. MUST BE USED for Ruby and Rails projects.",
  "security-reviewer":
    "Security reviewer for user input, authentication, API endpoints, and sensitive data. Flags secrets, SSRF, injection, unsafe crypto, and OWASP Top 10.",
  "swift-reviewer":
    "Swift reviewer for protocol-oriented design, value semantics, ARC, Swift Concurrency, and idiomatic patterns. MUST BE USED for Swift projects.",
  "typescript-reviewer":
    "TypeScript/JavaScript reviewer for type safety, async correctness, Node/web security, and idiomatic patterns. MUST BE USED for TypeScript/JavaScript projects.",
  "vue-reviewer":
    "Vue reviewer for Composition API, reactivity, component architecture, template security, and performance. MUST BE USED for Vue, Pinia, Vue Router, or Nuxt.",
};

export type EccSkill = { name: string; description: string; body: string };

const defaultDirectory = join(import.meta.dir, "../../skills/ecc");

export function loadEccSkills(directory = defaultDirectory): EccSkill[] {
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".md"))
    .sort();
  const expected = eccSkillNames.map((name) => `${name}.md`);
  if (files.join("\n") !== expected.join("\n")) throw new Error("ecc_skill_set_mismatch");
  return files.map((file) => parseSkillFile(file, readFileSync(join(directory, file), "utf8")));
}

function parseSkillFile(file: string, text: string): EccSkill {
  const name = file.slice(0, -".md".length);
  if (!text.startsWith("---\n")) throw new Error(`ecc_skill_frontmatter_missing:${name}`);
  const close = text.indexOf("\n---\n", 4);
  if (close === -1) throw new Error(`ecc_skill_frontmatter_unclosed:${name}`);
  const frontmatter = text.slice(4, close);
  const frontName = field(frontmatter, "name");
  if (frontName !== name || !isValidName(name)) throw new Error(`ecc_skill_name_invalid:${name}`);
  const rawDescription = field(frontmatter, "description");
  if (rawDescription.length < 1) throw new Error(`ecc_skill_description_missing:${name}`);
  const override = descriptionOverrides[name as (typeof eccSkillNames)[number]];
  const description = rawDescription.length > DESCRIPTION_LIMIT ? override : rawDescription;
  if (!description || description.length > DESCRIPTION_LIMIT || description.includes("\n") || description.includes("\r")) {
    throw new Error(`${name}_description_invalid`);
  }
  const checklist = text.slice(close + "\n---\n".length).trim();
  if (checklist.length < 1) throw new Error(`ecc_skill_body_missing:${name}`);
  const body = `${intro}\n\n${checklist}`;
  if (body.length > BODY_LIMIT) throw new Error(`${name}_body_invalid`);
  return { name, description, body };
}

function field(frontmatter: string, key: string): string {
  const prefix = `${key}:`;
  const line = frontmatter.split("\n").find((item) => item.startsWith(prefix));
  return unquote(line ? line.slice(prefix.length).trim() : "");
}

function unquote(value: string): string {
  if (value.length < 2) return value;
  const opening = value[0];
  if ((opening === '"' || opening === "'") && value.endsWith(opening)) return value.slice(1, -1);
  return value;
}
