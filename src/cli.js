// Command line: tenant-scope-check <sql-file-or-folder>... [options]

import { readFileSync } from 'node:fs';
import { InputError, LIMITS, checkPaths } from './check.js';
import { defaultsAsConfig } from './config.js';
import { LEVELS } from './data.js';
import { toGithub, toJson, toText } from './report.js';
import { RULES } from './rules.js';
import { safeText } from './text.js';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const FORMATS = { text: toText, json: toJson, github: toGithub };

export const USAGE = `Usage: tenant-scope-check <sql-file-or-folder>... [options]

Reads the SQL of a multi-tenant application that keeps every tenant in one shared database (the pool model): one
file, a folder, or the migrations and the query files together. It reports a SELECT, UPDATE or DELETE on a tenant
table with no condition on the tenant column, a tenant table joined on a key alone, an INSERT into a tenant table
that does not set the tenant column, a tenant table with no tenant column, and a tenant column that leads no index.
A statement marked with the comment -- tenant-scope: allow <reason> is listed as allowed. It reads SQL text only:
it opens no network connection, connects to no database, follows no symbolic link and writes nothing to disk.

Options:
  --config <file>           a configuration file (strict JSON) that names the tenant columns, the tenant tables or
                            "all" of them, the global tables, the file patterns of a folder and the level of the
                            rules (default: the built-in configuration; --print-defaults shows it)
  --format <name>           text, json or github (default: text); github writes workflow commands that GitHub shows
                            as annotations on the SQL files
  --json                    the same as --format json
  --min-severity <level>    the lowest level of a finding that is shown: ${LEVELS.join(', ')} (default: minSeverity of
                            the configuration, else notice)
  --explain                 show the rule and the public sources behind each finding
  --print-defaults          print the built-in configuration as a configuration file and exit
  --help                    show this text
  --version                 show the version

Rules: ${RULES.map((r) => `${r.id} (rules.${r.key})`).join(', ')}.

Exit codes: 0 no finding at the level error, 1 a finding at the level error, 2 usage or input error.
`;

const isUrl = (f) => /^[a-z][a-z0-9+.-]*:\/\//i.test(f);
export const MAX_INPUTS = 100;

export function parseArgs(argv) {
  const o = { inputs: [], config: null, format: null, json: false, minSeverity: null, explain: false, printDefaults: false, help: false, version: false };
  const once = (name, current, value) => {
    if (current !== null) throw new Error(`${name} was given twice`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || (v.startsWith('--') && v.length > 2)) throw new Error(`${a} needs a value`);
      if (v === '-') throw new Error('reading from standard input is not supported; give a file');
      i += 1;
      return v;
    };
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--explain') o.explain = true;
    else if (a === '--json') o.json = true;
    else if (a === '--print-defaults') o.printDefaults = true;
    else if (a === '--config') o.config = once(a, o.config, next());
    else if (a === '--format') o.format = once(a, o.format, next());
    else if (a === '--min-severity') o.minSeverity = once(a, o.minSeverity, next());
    else if (a === '-') throw new Error('reading from standard input is not supported; give a file');
    else if (a.startsWith('-')) throw new Error(`unknown argument ${a}`);
    else if (o.inputs.includes(a)) throw new Error(`${a} is named twice`);
    else if (o.inputs.length >= MAX_INPUTS) throw new Error(`more than ${MAX_INPUTS} paths; name the folders that hold the files`);
    else o.inputs.push(a);
  }
  if (o.json) {
    if (o.format !== null && o.format !== 'json') throw new Error(`--json and --format ${o.format} ask for two formats; give one`);
    o.format = 'json';
  }
  if (o.format === null) o.format = 'text';
  if (!o.help && !o.version && !o.printDefaults) {
    if (!o.inputs.length) throw new Error('give the SQL to check: a .sql file or a folder of them, such as tenant-scope-check db/migrations db/queries');
    for (const p of [...o.inputs, o.config].filter(Boolean)) if (isUrl(p)) throw new Error('give a local path; the tool never fetches a URL');
    if (!Object.hasOwn(FORMATS, o.format)) throw new Error(`unknown format ${o.format} (text, json or github)`);
    if (o.minSeverity !== null && !LEVELS.includes(o.minSeverity)) throw new Error(`unknown level ${o.minSeverity} (${LEVELS.join(', ')})`);
  }
  return o;
}

const clean = (text) => safeText(text, 1500);

// Exit code: 0 no finding at the level error, 1 a finding at the level error, 2 usage or input error.
export async function main(argv, io = { out: (t) => process.stdout.write(t), err: (t) => process.stderr.write(t) }, limits = undefined, base = process.cwd()) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (error) {
    io.err(`tenant-scope-check: ${clean(error.message)}\n\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    io.out(USAGE);
    return 0;
  }
  if (o.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }
  if (o.printDefaults) {
    io.out(`${JSON.stringify(defaultsAsConfig(), null, 2)}\n`);
    return 0;
  }
  let report;
  try {
    report = await checkPaths({ inputs: o.inputs, config: o.config, minSeverity: o.minSeverity, version: VERSION, limits: { ...LIMITS, ...(limits ?? {}) }, base });
  } catch (error) {
    if (error instanceof InputError) io.err(`tenant-scope-check: no result, the input has ${error.problems.length === 1 ? 'a problem' : 'problems'}:\n${error.problems.map((p) => `  ${clean(p)}`).join('\n')}\n`);
    else io.err(`tenant-scope-check: ${clean(error.message)}\n`);
    return 2;
  }
  io.out(FORMATS[o.format](report, { explain: o.explain }));
  return report.result.pass ? 0 : 1;
}
