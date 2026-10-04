#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const skillName = 'gpt-image-2-style-library';
const args = process.argv.slice(2);
const commandOrTarget = args[0] || 'install';
const allowedCommands = new Set(['install', 'sync']);

let command = commandOrTarget;
let targetArgs = args.slice(1);
if (!allowedCommands.has(commandOrTarget)) {
  command = 'install';
  targetArgs = args;
}

const usage = [
  'Usage: gpt-image-2-style-library install [all|codex|claude-code|agents]',
  'Examples:',
  '  gpt-image-2-style-library install all',
  '  gpt-image-2-style-library install claude-code',
  '  gpt-image-2-style-library install codex'
].join('\n');

if (!allowedCommands.has(command)) {
  console.error(usage);
  process.exit(1);
}

// Claude Code relocates ~/.claude via CLAUDE_CONFIG_DIR; CLAUDE_HOME is kept as a
// fallback so anyone who set it for earlier versions of this installer still works.
function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || process.env.CLAUDE_HOME || join(homedir(), '.claude');
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entries = ['SKILL.md', 'agents', 'assets', 'references'];
const targetDefinitions = {
  codex: {
    label: 'Codex',
    root: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills')
  },
  'claude-code': {
    label: 'Claude Code',
    root: join(claudeConfigDir(), 'skills')
  },
  agents: {
    label: 'Shared agent skills',
    root: join(process.env.AGENTS_HOME || join(homedir(), '.agents'), 'skills')
  }
};
const targetAliases = {
  all: Object.keys(targetDefinitions),
  codex: ['codex'],
  claude: ['claude-code'],
  'claude-code': ['claude-code'],
  agents: ['agents'],
  shared: ['agents']
};

for (const entry of entries) {
  const source = join(packageRoot, entry);
  if (!existsSync(source)) {
    throw new Error(`Missing package entry: ${entry}`);
  }
}

function selectedTargets(rawTargets) {
  const names = rawTargets.length ? rawTargets : ['all'];
  const selected = new Set();

  for (const name of names) {
    const normalized = name.toLowerCase();
    const matches = targetAliases[normalized];
    if (!matches) {
      console.error(usage);
      throw new Error(`Unknown target: ${name}`);
    }
    for (const match of matches) selected.add(match);
  }

  return [...selected].map((name) => targetDefinitions[name]);
}

for (const targetDefinition of selectedTargets(targetArgs)) {
  const target = join(targetDefinition.root, skillName);
  mkdirSync(targetDefinition.root, { recursive: true });
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  for (const entry of entries) {
    cpSync(join(packageRoot, entry), join(target, entry), { recursive: true });
  }

  console.log(`Installed ${skillName} for ${targetDefinition.label}: ${target}`);
}
