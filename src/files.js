// Reading the SQL files and the configuration named on the command line. A folder is walked without following a link:
// a symbolic link inside it is skipped and counted, and the files whose path matches the patterns of the configuration
// are read, in the order of their paths. Each file is opened once with O_NOFOLLOW where the system has it, and its type
// and size are taken from the open handle, so a file swapped for a link, a pipe or a device after it was named is
// refused, and a file over its limit is refused before it is read. A path named on the command line that is a symbolic
// link, a device or a pipe is refused. A file that holds a null byte, is UTF-16 or is not valid UTF-8 is refused as not
// text. The tool writes nothing to disk.

import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { SKIPPED_FOLDERS } from './defaults.js';
import { isIncluded } from './glob.js';
import { grouped } from './size.js';

export const FILE_LIMITS = { maxConfigBytes: 1024 * 1024, maxFileBytes: 2 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024, maxFiles: 5000, maxEntries: 100000, maxDepth: 32 };

// An error with the path in its message and the reason alone in .reason, so a caller can show its own path.
export function fileError(path, reason) {
  return Object.assign(new Error(`${path}: ${reason}`), { reason });
}

function megabytes(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toLocaleString('en-US')} MB` : `${bytes.toLocaleString('en-US')} byte`;
}

// The flags a file is opened with: read only, and not through a symbolic link where the system can refuse one.
export const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

// The whole file, or an error when it is not a regular file or is over the limit.
export async function readBounded(path, maxBytes) {
  let handle;
  try {
    handle = await open(resolve(path), OPEN_FLAGS);
  } catch (error) {
    if (error.code === 'ENOENT') throw fileError(path, 'no such file');
    if (error.code === 'ELOOP' || error.code === 'EMLINK') throw fileError(path, 'is a symbolic link, which is not followed');
    if (error.code === 'EISDIR') throw fileError(path, 'is a folder; give the file itself');
    throw fileError(path, `cannot be read (${error.code ?? error.message})`);
  }
  try {
    const opened = await handle.stat();
    if (opened.isDirectory()) throw fileError(path, 'is a folder; give the file itself');
    if (!opened.isFile()) throw fileError(path, 'not a regular file');
    if (opened.size > maxBytes) throw fileError(path, `${opened.size.toLocaleString('en-US')} bytes is over the ${megabytes(maxBytes)} limit`);
    const buffer = Buffer.alloc(opened.size);
    let read = 0;
    while (read < opened.size) {
      const { bytesRead } = await handle.read(buffer, read, opened.size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return buffer.subarray(0, read);
  } finally {
    await handle.close();
  }
}

function toPosix(path) {
  return sep === '/' ? path : path.split(sep).join('/');
}

// A path as shown in a report: relative to the base folder with forward slashes; a path outside it is shown absolute,
// also with forward slashes.
export function displayPath(path, base) {
  const rel = relative(base, path);
  if (rel === '') return '.';
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return toPosix(path);
  return toPosix(rel);
}

// A file holds binary data when its first 8,000 bytes hold a null byte.
export const isBinary = (buffer) => buffer.subarray(0, 8000).includes(0);

const isUtf16 = (buffer) => buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff));

// UTF-8 text without a leading byte order mark, or null when the bytes are not valid UTF-8.
export function decodeText(buffer) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
  } catch {
    return null;
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// The text of a file, or an error whose .reason says why it is not read: missing, a link, a folder, not a regular file,
// over the limit, UTF-16, binary or not UTF-8. shown is the path the error names.
export async function readText(full, shown, maxBytes) {
  const buffer = await readBounded(full, maxBytes).catch((error) => {
    throw fileError(shown, error.reason ?? error.message);
  });
  if (isUtf16(buffer)) throw fileError(shown, 'is UTF-16; only UTF-8 is read');
  if (isBinary(buffer)) throw fileError(shown, 'holds binary data (a null byte); only text is read');
  const text = decodeText(buffer);
  if (text === null) throw fileError(shown, 'is not valid UTF-8; only UTF-8 text is read');
  return { size: buffer.length, text };
}

// What the path named on the command line is: { full, shown, folder }, or an error when it is missing, a symbolic link
// or not a regular file or folder. The path is looked at without following a link. With folders false, a folder is
// refused too.
export async function inspectPath(path, base, folders = false) {
  const full = resolve(base, path);
  const shown = displayPath(full, base);
  let info;
  try {
    info = await lstat(full);
  } catch (error) {
    if (error.code === 'ENOENT') throw fileError(shown, 'no such file');
    throw fileError(shown, `cannot be read (${error.code ?? error.message})`);
  }
  if (info.isSymbolicLink()) throw fileError(shown, 'is a symbolic link, which is not followed; name the file or folder itself');
  if (info.isDirectory()) {
    if (!folders) throw fileError(shown, 'is a folder; give the file itself');
    return { full, shown, folder: true };
  }
  if (!info.isFile()) throw fileError(shown, 'is not a regular file');
  return { full, shown, folder: false };
}

// One file named on the command line, read as text: { file, full, size, text }.
export async function readTextFile(path, base, maxBytes) {
  const { full, shown } = await inspectPath(path, base);
  return { file: shown, full, ...(await readText(full, shown, maxBytes)) };
}

// Compares two strings by their UTF-16 code units, so the order does not depend on the locale.
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// The SQL files of the paths named on the command line: a file is read whatever its name; a folder is walked, and a
// file in it is read when its path relative to the folder matches files and not exclude. Returns { files: [{ full,
// shown }], named, skippedLinks }, where named holds the paths as given, as the report shows them. A path that names
// nothing to read, or a walk past its limits, is an error, so a run never passes with nothing read.
export async function collectFiles(paths, base, { files: patterns, exclude }, limits = FILE_LIMITS) {
  const out = [];
  const named = [];
  const seen = new Set();
  let skippedLinks = 0;
  let entries = 0;
  const add = (full) => {
    if (seen.has(full)) return;
    seen.add(full);
    if (out.length >= limits.maxFiles) throw fileError(displayPath(full, base), `more than ${grouped(limits.maxFiles)} SQL files; name fewer folders or narrow the files patterns`);
    out.push({ full, shown: displayPath(full, base) });
  };
  for (const path of paths) {
    const given = await inspectPath(path, base, true);
    named.push(given.shown);
    if (!given.folder) {
      add(given.full);
      continue;
    }
    let matched = 0;
    const walk = async (dir, rel, depth) => {
      if (depth > limits.maxDepth) throw fileError(displayPath(dir, base), `folders nested more than ${limits.maxDepth} deep`);
      let list;
      try {
        list = await readdir(dir, { withFileTypes: true });
      } catch (error) {
        throw fileError(displayPath(dir, base), `cannot be read (${error.code ?? error.message})`);
      }
      list.sort((a, b) => byCode(a.name, b.name));
      for (const e of list) {
        entries += 1;
        if (entries > limits.maxEntries) throw fileError(given.shown, `more than ${grouped(limits.maxEntries)} files and folders to look at`);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isSymbolicLink()) skippedLinks += 1;
        else if (e.isDirectory()) {
          if (!SKIPPED_FOLDERS.includes(e.name)) await walk(resolve(dir, e.name), r, depth + 1);
        } else if (e.isFile() && isIncluded(r, patterns, exclude)) {
          matched += 1;
          add(resolve(dir, e.name));
        }
      }
    };
    await walk(given.full, '', 0);
    if (!matched) throw fileError(given.shown, `no file in this folder matches ${patterns.join(', ')}${exclude.length ? ` outside ${exclude.join(', ')}` : ''}`);
  }
  return { files: out, named, skippedLinks };
}
