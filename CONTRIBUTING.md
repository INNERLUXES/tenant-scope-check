# Contributing

Every change goes through a pull request and is reviewed before it is merged. The pipeline runs the tests on Linux, Windows and macOS with Node 22 and 24, the tests with coverage, the repository checks, CodeQL, and a secure development check of the repository itself.

Commit messages in this repository follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`, with `!` for a breaking change.

## Changing a rule

1. Describe the change in docs/method.md first: what the rule looks at and what it can and cannot see. Where the tool makes its own choice, say so in `own` in src/rules.js and say why.
2. Keep the rules conservative. A finding must point at something a reader can check in the SQL: a table in a FROM list, a target, a column list, a CREATE TABLE or a comment. Never add a rule that guesses what a name or a value means.
3. A run must never pass because something could not be read: an input that cannot be read, or SQL the tokenizer cannot place, stops the run with exit code `2`.
4. Never read the clock or a date ([decision 1](docs/decisions/0001-read-no-clock-and-keep-dates-out-of-the-repository.md)).
5. Add a test with the SQL written inline (`queryReport()` and `reportOf()` in test/helpers.js check a query after a small schema), small enough that the result can be worked out by hand, with a near miss on each side.
6. A rule id, once released, keeps its meaning: pipelines and other tools read it from the JSON output and the GitHub annotations.

## Changing how conditions are read

1. Only conditions every row must pass count, and an outer join limits only one side ([decision 3](docs/decisions/0003-a-condition-counts-only-when-every-row-must-pass-it.md)). A change to this changes the result of many queries; describe it in a decision first.
2. Keep src/queries.js the one place where blocks, joins and conditions are read; the rules and the report read its findings.

## Changing the tokenizer

1. The tokenizer reads the lexical forms of docs/method.md and nothing more ([decision 2](docs/decisions/0002-read-sql-with-a-tokenizer-not-a-full-parser.md)). A new form gets a test of the form itself and of the same form left open, which must stop the run with its line.
2. Keep the work bounded: one pass over each file, the end of a string or a dollar quote found with one search, the limits of docs/limits.md, and a hostile test with a large input and a time check.

## Changing the configuration file

1. A new key is added to `KEYS` in src/config.js, documented in docs/inputs.md and tested with a good value and a bad one. Every key the tool does not know stays an error, and a key named twice stays refused.
2. A list of the configuration keeps the array form and `replace`, `add` and `remove`; removing an entry that is not there stays an error.
3. Never add a key that takes a regular expression. File patterns are matched by hand in src/glob.js.

## Changing a source

1. Every point the reports show is in src/data.js, written in this project's own words, with the page it comes from. A short phrase of a page may be named; a long quotation may not.
2. research/sources.md lists every page with a note on what it says, and docs/rules-and-sources.md lists every rule with its points. A test checks all three against each other.

## Changing a reader of files

1. The tool reads; it never follows. A symbolic link named on the command line is refused, a link inside a folder is skipped, and nothing but the files named, the files a walk matches and the configuration is opened.
2. A time check in a test widens under coverage: read `process.env.NODE_V8_COVERAGE`, which the test runner sets only when coverage is on, and allow four times the time. Never read the flags of the process for this, because they hold the coverage flags of the runner in every run. Run `npm run test:coverage` before you open the pull request.
3. SQL written with LF and with CRLF line ends, with or without a byte order mark, must give the same output. The example files are stored as written (`.gitattributes`), and a test reads them both ways.

## Tests that depend on the system

A test that depends on the operating system (a symbolic link, a device, file permissions, a character that a file name cannot hold on every system) is guarded with `process.platform`, says why in its `t.skip`, and asserts no line of its own: a line is asserted only in a test that runs on every system, and is worked out there with `lineOf()` of test/helpers.js or from the text itself, never written by hand. `test/repo.test.js` fails when a guarded test asserts a line. Every other test builds its paths with `resolve()` from names with forward slashes.

A test never reads the clock, the time zone or the locale.

## Rules for the code

- No runtime dependencies and no development dependencies. Node 22 or newer and nothing else; the tests use `node:test`.
- The tool reads the files and the configuration it is given and writes only to standard output and standard error. It opens no network connection, connects to no database and runs no program.
- Text from the input, file names included, goes through `safeText` before it reaches the output or an error message.
- Source files stay ASCII; write any other character as a Unicode escape, or build it from its code point.
- Never commit a real secret, even as a fixture. `npm run check` fails on anything that looks like a credential.
- No file carries a date, and no file holds a number that reads like a year. Version numbers (Node 22, 1.0.0) and the numbers of a standard (RFC 8259, CWE-639) are fine.
- Examples and tests use made-up products, tables and tenants, never the schema or the queries of a real product.
- Plain words in the documents: `npm run check` fails on a short list of words that say little.

## Before you open the pull request

```
npm test
npm run test:coverage
npm run check
npm run example
```
