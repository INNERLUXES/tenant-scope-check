// The file patterns of the configuration (files and exclude), matched by hand and never turned into a regular
// expression. A pattern is a path with forward slashes in which * matches any run of characters inside one folder or
// file name, ? matches one character, and ** as a whole part matches any number of folders. A pattern with no slash
// matches the file name in any folder. Character classes, braces, a leading slash, a backslash and .. are refused.

export const GLOB_LIMITS = { maxLength: 200 };

// The reason a pattern is refused, or null when it is a pattern the tool reads.
export function globProblem(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > GLOB_LIMITS.maxLength) return `must hold 1 to ${GLOB_LIMITS.maxLength} characters`;
  if (/[[\]{}!\\]/.test(pattern)) return 'holds [ ] { } ! or a backslash; only * ? and ** are read';
  if (pattern.startsWith('/')) return 'starts with a slash; patterns are relative to the folder named on the command line';
  const parts = pattern.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return 'has an empty part, . or ..';
  if (parts.some((p) => p.includes('**') && p !== '**')) return '** must be a whole part, as in **/*.sql';
  if (/[\x00-\x1f\x7f]/.test(pattern)) return 'holds a control character';
  return null;
}

// One name against one part of a pattern, with * and ?. Greedy with one step back, so the work stays the product of the
// two lengths at most.
function matchPart(pattern, name) {
  let p = 0;
  let n = 0;
  let star = -1;
  let mark = 0;
  while (n < name.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === name[n])) {
      p += 1;
      n += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p;
      p += 1;
      mark = n;
    } else if (star >= 0) {
      p = star + 1;
      mark += 1;
      n = mark;
    } else return false;
  }
  while (pattern[p] === '*') p += 1;
  return p === pattern.length;
}

// True when a relative path with forward slashes matches the pattern.
export function globMatch(pattern, path) {
  const pp = pattern.includes('/') ? pattern.split('/') : ['**', pattern];
  const sp = path.split('/');
  // can[i][j]: the pattern from part i matches the path from part j. Filled from the end.
  const can = Array.from({ length: pp.length + 1 }, () => new Array(sp.length + 1).fill(false));
  can[pp.length][sp.length] = true;
  for (let i = pp.length - 1; i >= 0; i -= 1) {
    for (let j = sp.length; j >= 0; j -= 1) {
      if (pp[i] === '**') can[i][j] = can[i + 1][j] || (j < sp.length && can[i][j + 1]);
      else can[i][j] = j < sp.length && matchPart(pp[i], sp[j]) && can[i + 1][j + 1];
    }
  }
  return can[0][0];
}

// True when a path is read: it matches one of the files patterns and none of the exclude patterns.
export const isIncluded = (path, files, exclude) => files.some((g) => globMatch(g, path)) && !exclude.some((g) => globMatch(g, path));
