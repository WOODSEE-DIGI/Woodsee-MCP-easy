#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key.startsWith("--")) {
      args[key.slice(2)] = next && !next.startsWith("--") ? next : true;
      if (next && !next.startsWith("--")) i++;
    }
  }
  return args;
}

function buildPrompt({ name, mode, project, workspace }) {
  const common = [
    `You are ${name}, an AI agent for ${project}.`,
    `Operate primarily inside the configured workspace scope: ${workspace}.`,
    "Do not invent files, APIs, or facts when uncertain; explicitly call out uncertainty.",
    "Prefer concise, actionable responses over long theory.",
    "When relevant, include concrete file paths and clear next actions.",
  ];

  if (mode === "strategist") {
    return [
      ...common,
      "Role: high-context planner and cross-component strategist.",
      "Start with a short answer, then provide prioritized steps.",
      "Highlight dependencies, risks, and sequencing.",
      "When multiple approaches exist, recommend one with brief trade-offs.",
      "Distinguish observed facts from assumptions.",
    ].join("\n");
  }

  return [
    ...common,
    "Role: implementation-focused engineer.",
    "Prioritize minimal, safe changes that preserve current architecture.",
    "For debugging, identify probable root cause first, then smallest safe fix.",
    "Surface regression risks and edge cases before proposing changes.",
    "Ask clarification questions only when blocked by missing requirements.",
  ].join("\n");
}

function usage() {
  console.log(
    [
      "Usage:",
      "  node generate-agent-prompt.mjs --name <AgentName> --mode <implementer|strategist> --workspace <scope> [--project <name>] [--output <file>]",
      "",
      "Example:",
      "  node generate-agent-prompt.mjs --name Mistral --mode implementer --workspace \"$HOME/Documents/GitHub/SwiftMaestro\" --project SwiftMaestro --output \"$HOME/.ai-context/Mistral-System-Prompt.txt\"",
    ].join("\n")
  );
}

const args = parseArgs(process.argv);
const name = args.name;
const mode = args.mode || "implementer";
const project = args.project || "SwiftMaestro";
const workspace = args.workspace || "configured workspace folders";
const output = args.output;

if (!name || !["implementer", "strategist"].includes(mode)) {
  usage();
  process.exit(1);
}

const prompt = buildPrompt({ name, mode, project, workspace });

if (output) {
  const absPath = resolve(output);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, prompt + "\n", "utf8");
  console.log(`Wrote prompt to: ${absPath}`);
} else {
  console.log(prompt);
}
