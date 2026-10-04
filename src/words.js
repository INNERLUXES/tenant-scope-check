// Words compared as the tool compares them: the letters A to Z lowered whatever the locale, an apostrophe dropped, every
// other character that is not a letter or a digit read as a space, and runs of spaces as one. Used for the reasons
// that say nothing (TBD, none) and for the names of the configuration.

// Lowercase for the letters A to Z only, so the result does not depend on the locale.
export const asciiLower = (text) => String(text).replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

// A phrase in the form it is compared in: "N/A" is "n a", "Don't know" is "dont know".
export function normalizePhrase(text) {
  return asciiLower(text).replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

// True when a value says nothing: missing, empty, only marks, or one of the empty values such as TBD.
export function isEmptyValue(value, emptyValues) {
  if (value === null || value === undefined) return true;
  const n = normalizePhrase(value);
  return n === '' || emptyValues.includes(n);
}
