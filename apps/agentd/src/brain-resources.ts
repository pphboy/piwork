import { chmodSync, readdirSync, cpSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { BRAIN_LIMITS, BRAIN_PACKAGE_NAME } from "@piwork/contracts";
import { FeedbackError, type ExperienceSnapshot, type MemorySelection } from "@piwork/work-store";
import { packageNameKey, type PackageBinding } from "./package-resources.js";

export const BRAIN_TOOL_NAMES = ["brain_service", "brain_feedback", "brain_experience", "brain_package_update"] as const;

export function readBrainCognition(root: string): string {
  const path = join(root, "brain.md");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > BRAIN_LIMITS.cognitionBytes) {
    throw new FeedbackError("BRAIN_COGNITION_INVALID", "Frozen brain cognition is missing or exceeds 64 KiB");
  }
  const raw = readFileSync(path);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(raw); }
  catch { throw new FeedbackError("BRAIN_COGNITION_INVALID", "Frozen brain cognition has invalid UTF-8"); }
  if (text.includes("\0") || !text.trim()) throw new FeedbackError("BRAIN_COGNITION_INVALID", "Frozen brain cognition is invalid");
  return text;
}

export function brainPrompt(cognition: string, experience?: ExperienceSnapshot, selection?:MemorySelection|null): string[] {
  const provided=selection?`Initial Memory selection: ${JSON.stringify(selection)}. ${selection.truncated?"More matches were not provided; recall/read uses this same fixed version.":"No matching entries were omitted."}\n`:"";
  return [cognition, ...(experience ? [`Confirmed Work experience adopted for this Run (version ${experience.version}):\nThis is the authoritative snapshot for this invocation; earlier conversation cognition is historical.\n${provided}${JSON.stringify(experience.entries)}`] : [])];
}

/** Copy once, atomically. Neither restart nor Apply changes existing source files. */
export function initializeBrainSource(input: { frozenRoot: string; workspace: string; privateDirectory: string; binding: PackageBinding }): void {
  if (input.binding.name !== BRAIN_PACKAGE_NAME || input.binding.nameKey !== packageNameKey(BRAIN_PACKAGE_NAME)) throw new Error("Brain binding mismatch");
  readBrainCognition(input.frozenRoot);
  let parent = input.workspace;
  for (const segment of [".pi", "packages"]) {
    parent = join(parent, segment);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Brain source parent is invalid");
  }
  const target = join(parent, BRAIN_PACKAGE_NAME);
  let existing = false;
  try { const stat = lstatSync(target); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Brain source is invalid"); existing = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!existing) {
    const temporary = join(parent, `.brain-copy-${randomUUID()}`);
    try { cpSync(input.frozenRoot, temporary, { recursive: true, dereference: false, errorOnExist: true, force: false }); makeEditable(temporary); renameSync(temporary, target); }
    finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  const baseline = join(input.privateDirectory, "brain-active.json");
  mkdirSync(dirname(baseline), { recursive: true, mode: 0o700 });
  const temporary = `${baseline}.${randomUUID()}`;
  try { writeFileSync(temporary, JSON.stringify({ name: input.binding.name, version: input.binding.artifact.version,
    contentDigest: input.binding.artifact.contentDigest }), { mode: 0o600, flag: "wx" }); renameSync(temporary, baseline); }
  finally { rmSync(temporary, { force: true }); }
}

/** Frozen artifacts may be 0444/0555; the separate source copy belongs to the Work. */
function makeEditable(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) { chmodSync(path, (stat.mode & 0o777) | 0o700); for (const name of readdirSync(path)) makeEditable(join(path, name)); }
  else if (stat.isFile()) chmodSync(path, (stat.mode & 0o777) | 0o600);
  else throw new Error("Brain source contains unsupported storage");
}
