#!/usr/bin/env node
// Writes the uier-monitor-script skill, which carries a copy of monitor.mjs for installs of the
// uier-monitor skill that don't include its scripts folder.
//
//   node .claude/skills/uier-monitor/scripts/build-script-skill.mjs           # write it
//   node .claude/skills/uier-monitor/scripts/build-script-skill.mjs --check   # fail when out of date

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'monitor.mjs'), 'utf8');
const skillFile = join(here, '..', 'SKILL.md');
const target = join(here, '..', '..', 'uier-monitor-script', 'SKILL.md');

const problems = [];
const version = /^const VERSION = '([^']+)';$/m.exec(source)?.[1];
if (!version) problems.push('monitor.mjs has no `const VERSION = \'x.y.z\';` line.');
if (!source.endsWith('\n')) problems.push('monitor.mjs must end with a newline.');
if (source.includes('````')) problems.push('monitor.mjs must not contain four backticks in a row.');
if (/^<!-- monitor\.mjs:(begin|end) -->$/m.test(source)) problems.push('monitor.mjs must not contain an extraction marker line.');
const expected = /^MONITOR_VERSION: (\S+)$/m.exec(readFileSync(skillFile, 'utf8'))?.[1];
if (expected !== version) problems.push(`uier-monitor/SKILL.md says MONITOR_VERSION: ${expected ?? '(missing)'}, monitor.mjs is ${version}.`);
if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
}

const sha256 = createHash('sha256').update(source).digest('hex');
const skill = `---
name: uier-monitor-script
description: Recreate monitor.mjs, the watcher and state helper of the uier-monitor skill, when that skill was installed without its scripts folder or its copy is outdated. Use when the uier-monitor skill asks for it.
---

# Recreate the uier monitor helper

This skill carries \`monitor.mjs\` version ${version}, sha256 \`${sha256}\`. It needs Node 18 or later
and has no dependencies. The uier-monitor skill runs it as \`ROOT/monitor.mjs\`, where \`ROOT\` is
\`$(git rev-parse --path-format=absolute --git-common-dir)/uier-monitor\`.

1. When this file is on disk (its directory is shown when the skill loads), extract the script
   instead of retyping it:

   \`\`\`bash
   ROOT="$(git rev-parse --path-format=absolute --git-common-dir)/uier-monitor"
   mkdir -p "$ROOT"
   awk '/^<!-- monitor.mjs:begin -->$/{s=1;next} /^<!-- monitor.mjs:end -->$/{s=0} s' "<this skill's directory>/SKILL.md" | sed '1d;$d' > "$ROOT/monitor.mjs"
   \`\`\`

2. Only when this file isn't on disk, write the code below to \`$ROOT/monitor.mjs\` exactly as shown.
3. Check it: \`node "$ROOT/monitor.mjs" version\` must print version ${version} and sha256
   \`${sha256}\`. If the hash differs, write the file again; never patch it by hand.

Don't edit the code here. Its source is \`.claude/skills/uier-monitor/scripts/monitor.mjs\` in the uier
repository, and \`build-script-skill.mjs\` next to it writes this file.

<!-- monitor.mjs:begin -->
\`\`\`\`js
${source}\`\`\`\`
<!-- monitor.mjs:end -->
`;

const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
if (process.argv.includes('--check')) {
    if (current !== skill) {
        console.error(`${relative(process.cwd(), target)} is out of date. Run: node ${relative(process.cwd(), fileURLToPath(import.meta.url))}`);
        process.exit(1);
    }
    console.log(`uier-monitor-script is up to date (monitor.mjs ${version}, sha256 ${sha256.slice(0, 12)}…).`);
} else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, skill);
    console.log(`Wrote ${relative(process.cwd(), target)} (monitor.mjs ${version}, sha256 ${sha256}).`);
}
