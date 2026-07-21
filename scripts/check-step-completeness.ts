#!/usr/bin/env npx tsx

/**
 * @fileoverview CLI entrypoint that scores an active step-by-step markdown step against the
 * twelve-item Step Quality Checklist and prints a human-readable or JSON completeness report.
 *
 * This file owns session directory resolution under `.tmp/step-by-step`, regex-driven checklist
 * probes over the active step markdown body, weighted scoring, and stdout/stderr reporting used as
 * a preflight gate before presenting a step.
 * Flow: parse `--session` path or `latest` -> locate `*.md` (prefer filename containing `active`) ->
 * read markdown -> extract metadata and tier hints -> evaluate checklist rows -> emit report.
 *
 * Accuracy note: some historical usage snippets referenced `--step <step-id>`, but this entrypoint
 * currently resolves only `--session` paths before `checkStep`; align operator docs if that flag is
 * still intended.
 *
 * @testing CLI: npx tsx .agents/skills/step-by-step/scripts/check-step-completeness.ts --session .tmp/step-by-step/<session-dir>
 * @testing CLI: npx tsx .agents/skills/step-by-step/scripts/check-step-completeness.ts --session latest --json
 *
 * @see skills/step-by-step/SKILL.md - Canonical step-by-step skill surface that tells operators when to run this completeness gate before presenting an active step.
 * @see skills/step-by-step/references/step-presentation-contract.md - Step presentation contract aligned with the checklist rows and heuristics evaluated in this script.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_FILE_OVERVIEWS.md - File-overview documentation standard that defines the audited header shape used at the top of this TypeScript CLI.
 * @documentation reviewed=2026-05-22 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { argv } from "process";

// ============================================================================
// Types
// ============================================================================

/**
 * One Step Quality Checklist row with scoring weight and scan result flag.
 *
 * @remarks
 * `checked` is populated after regex heuristics run over the step markdown body.
 */
interface ChecklistItem {
  number: number;
  name: string;
  description: string;
  required: boolean;
  checked: boolean;
  weight: number;
}

/**
 * Parsed identity and ownership hints for a single markdown step file.
 *
 * @remarks
 * Drives console and JSON report headers; `tier` is a separate heuristic from checklist scoring.
 */
interface StepMetadata {
  stepId: string;
  title: string;
  path: string;
  owner: string;
  tier: string;
}

/**
 * Full completeness payload for one scanned step session.
 *
 * @remarks
 * Emitted as JSON when `--json` is set; otherwise summarized to the terminal.
 */
interface CompletenessReport {
  metadata: StepMetadata;
  checklist: ChecklistItem[];
  score: number;
  maxScore: number;
  tier: string;
  canPresent: boolean;
}

// ============================================================================
// Checklist Definition
// ============================================================================

const CHECKLIST_ITEMS: Omit<ChecklistItem, "checked">[] = [
  { number: 1, name: "Queue normalized", description: "Ordered step queue with STEP_IDs and status", required: true, weight: 2 },
  { number: 2, name: "Session folder initialized", description: "Timestamped folder in .tmp/step-by-step/", required: true, weight: 2 },
  { number: 3, name: "Next step identified", description: "Unresolved step with highest priority", required: true, weight: 2 },
  { number: 4, name: "Preflight checks run", description: "Agent-verifiable checks completed", required: true, weight: 1 },
  { number: 5, name: "Owner separated", description: "Agent vs user actions clearly distinguished", required: true, weight: 2 },
  { number: 6, name: "Title concise", description: "Step title is one clear sentence", required: true, weight: 2 },
  { number: 7, name: "Prerequisites listed", description: "Dependencies are explicit", required: true, weight: 1 },
  { number: 8, name: "Verification method stated", description: "Exact evidence required for resolution", required: true, weight: 2 },
  { number: 9, name: "Chooseable options included", description: "AUTOMATION/HELP/CONTROL options present", required: true, weight: 2 },
  { number: 10, name: "Resolution criteria clear", description: "What counts as \"done\" is explicit", required: true, weight: 1 },
  { number: 11, name: "Persistence maintained", description: "State saved after every change", required: false, weight: 1 },
  { number: 12, name: "Handoff ready", description: "Outputs prepared for skill transitions", required: false, weight: 1 },
];

// ============================================================================
// Parser
// ============================================================================

/**
 * Extracts step id, title, owner label, and tier guess from markdown content.
 *
 * @remarks
 * PURITY: regex-only parse of `content`; `path` is recorded verbatim for reporting, not read from disk here.
 * @param content - Full markdown body of the active step file.
 * @param path - Filesystem path string stored on the returned metadata for display.
 */
function extractMetadata(content: string, path: string): StepMetadata {
  const stepMatch = content.match(/^#\s*Step:\s*(STEP_\d+)\s*[-–]\s*(.+)/m);
  const ownerMatch = content.match(/\*\*Owner:\*\*\s*(user|agent|shared)/mi);
  
  return {
    stepId: stepMatch?.[1]?.trim() || "STEP_UNKNOWN",
    title: stepMatch?.[2]?.trim() || "Untitled Step",
    path: path,
    owner: ownerMatch?.[1]?.trim() || "shared",
    tier: guessTier(content),
  };
}

/**
 * Classifies markdown richness into Full, Standard, or Minimal tier labels.
 *
 * @remarks
 * PURITY: pattern scan only; complements weighted checklist scoring in `checkStep`.
 * @param content - Markdown body evaluated for automation, prerequisites, and handoff cues.
 */
function guessTier(content: string): string {
  const hasAutomation = /AUTOMATION_OPTIONS|AUTOMATE_/i.test(content);
  const hasPrereqs = /Prerequisites|STEP_\d+/i.test(content);
  const hasHandoff = /Handoff|Next Step/i.test(content);
  
  if (hasAutomation && hasPrereqs && hasHandoff) return "Full";
  if (hasAutomation && hasPrereqs) return "Standard";
  return "Minimal";
}

/**
 * Heuristic match for one checklist criterion against step markdown.
 *
 * @remarks
 * Number-specific regex and keyword probes; optional rows may short-circuit as satisfied.
 * @param content - Markdown scanned for this checklist item.
 * @param item - Template row without `checked`; `number` selects the probe branch.
 */
function checkItem(content: string, item: Omit<ChecklistItem, "checked">): boolean {
  switch (item.number) {
    case 1: return /STEP_\d+|\[STEP_/i.test(content);
    case 2: return /\.tmp\/step-by-step\//i.test(content) || /session|folder/i.test(content);
    case 3: return /next|following|active/i.test(content);
    case 4: return /preflight|check|verify/i.test(content) || item.required === false;
    case 5: return /What I Can Do|What You Need To Do|agent.*action|user.*action/i.test(content);
    case 6: return /^#.*Step:.*[-–].*\n/m.test(content);
    case 7: return /Prerequisites|dependencies|prereq/i.test(content);
    case 8: return /Verification|verify|evidence|complete/i.test(content);
    case 9: return /AUTOMATION_OPTIONS|HELP_OPTIONS|CONTROL_OPTIONS/i.test(content);
    case 10: return /done|complete|resolved|success/i.test(content);
    case 11: return /persist|save|session|state/i.test(content) || item.required === false;
    case 12: return /handoff|next.*skill/i.test(content) || item.required === false;
    default: return false;
  }
}

// ============================================================================
// Main
// ============================================================================

/**
 * Picks the lexicographically last directory under `.tmp/step-by-step`.
 *
 * @remarks
 * I/O: lists and stats child directories; returns null when the base path is missing or empty.
 * @returns Joined path to the newest session folder, or null when none resolve.
 */
function findLatestSession(): string | null {
  try {
    const tmpDir = ".tmp/step-by-step";
    if (!existsSync(tmpDir)) return null;
    
    const dirs = readdirSync(tmpDir)
      .filter(d => statSync(join(tmpDir, d)).isDirectory())
      .sort()
      .reverse();
    
    if (dirs.length > 0) {
      return join(tmpDir, dirs[0]);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Scores the active markdown step in a session and prints human or JSON output.
 *
 * @remarks
 * I/O: reads session directory and chosen step file; writes to stdout/stderr; calls `process.exit` on hard failures.
 * @param sessionPath - Directory containing one or more `*.md` step files.
 * @param json - When true, prints a single JSON object instead of formatted text.
 */
function checkStep(sessionPath: string, json: boolean = false): void {
  try {
    // Find the active step file
    const files = readdirSync(sessionPath).filter(f => f.endsWith(".md"));
    if (files.length === 0) {
      console.error("❌ No step files found in session directory.");
      process.exit(1);
    }
    
    const activeStep = files.find(f => f.includes("active")) || files[0];
    const stepPath = join(sessionPath, activeStep);
    const content = readFileSync(stepPath, "utf-8");
    
    const metadata = extractMetadata(content, stepPath);
    
    const checklist = CHECKLIST_ITEMS.map(item => ({
      ...item,
      checked: checkItem(content, item),
    }));
    
    const score = checklist.reduce((sum, item) => 
      item.checked ? sum + item.weight : sum, 0);
    const maxScore = checklist.reduce((sum, item) => sum + item.weight, 0);
    
    const requiredItems = checklist.filter(i => i.required);
    const requiredScore = requiredItems.reduce((sum, item) => 
      item.checked ? sum + item.weight : sum, 0);
    const requiredMax = requiredItems.reduce((sum, item) => sum + item.weight, 0);
    
    const canPresent = requiredScore === requiredMax;
    
    const tier = score >= 16 ? "Full" : score >= 10 ? "Standard" : "Minimal";

    const report: CompletenessReport = {
      metadata,
      checklist,
      score,
      maxScore,
      tier,
      canPresent,
    };

    if (json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Human-readable output
    console.log("\n📋 Step Completeness Report");
    console.log("═".repeat(60));
    console.log(`\n📄 ${metadata.stepId} - ${metadata.title}`);
    console.log(`   Owner: ${metadata.owner}`);
    console.log(`   Path: ${stepPath}`);
    
    console.log(`\n📊 Score: ${score}/${maxScore} (${((score/maxScore)*100).toFixed(0)}%)`);
    console.log(`   Required items: ${requiredScore}/${requiredMax}`);
    console.log(`   Quality tier: ${tier}`);
    
    console.log(`\n${canPresent ? "✅" : "⚠️"} Presentable: ${canPresent ? "YES" : "NEEDS WORK"}`);
    
    console.log("\n📝 Checklist:");
    for (const item of checklist) {
      const icon = item.checked ? "✅" : item.required ? "❌" : "⚠️";
      console.log(`   ${icon} [${item.number}] ${item.name}`);
    }
    
    console.log("\n" + "═".repeat(60));
    
    if (!canPresent) {
      console.log("\n⚠️ Step needs work before presenting.");
      const failedItems = checklist.filter(i => !i.checked && i.required);
      if (failedItems.length > 0) {
        console.log("\nMissing required items:");
        failedItems.forEach(i => console.log(`   - ${i.name}`));
      }
    } else {
      console.log("\n✅ Step is complete and ready to present.");
    }
    
  } catch (error) {
    console.error(`\n❌ Error checking step: ${sessionPath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// CLI
const args = argv.slice(2);
const stepArg = args.find(a => a === "--step" || a === "-s");
const sessionArg = args.find(a => a === "--session" || a === "-d");
const jsonArg = args.includes("--json");

if (!stepArg && !sessionArg) {
  console.log("Usage: check-step-completeness.ts --session <dir> | --step <step-id> [--json]");
  console.log("\nExamples:");
  console.log("  npx tsx check-step-completeness.ts --session .tmp/step-by-step/2026-05-19-test");
  console.log("  npx tsx check-step-completeness.ts --session .tmp/step-by-step/latest --json");
  process.exit(1);
}

let sessionPath: string | null = null;

if (sessionArg) {
  const sessionIndex = args.indexOf(sessionArg);
  sessionPath = args[sessionIndex + 1];
  if (!sessionPath) {
    console.error("❌ Missing session directory path");
    process.exit(1);
  }
  if (sessionPath === "latest") {
    sessionPath = findLatestSession();
    if (!sessionPath) {
      console.error("❌ No session found in .tmp/step-by-step/");
      process.exit(1);
    }
  }
}

checkStep(sessionPath!, jsonArg);
