## What changes

<!-- One or two sentences. -->

## Checks

- [ ] `npm test`, `npm run test:coverage`, `npm run check` and `npm run example` pass, and the files under `examples/output` are the ones `npm run example` wrote
- [ ] A change to a rule, the tokenizer or the way conditions are read is described in docs/method.md, says what it can and cannot see, and has a test with the SQL written inline and a near miss on each side
- [ ] A change to a key of the configuration, or to a default, is in docs/inputs.md and in the README
- [ ] A change to a point of a public page is in src/data.js, research/sources.md and docs/rules-and-sources.md, in this project's own words, with no long quotation
- [ ] No pattern is built from the configuration or the SQL
- [ ] Text from the input goes through `safeText` before it reaches the output or an error message, and the GitHub format escapes what a workflow command gives a meaning to
- [ ] The tool still opens no network connection, connects to no database, runs no program, follows no symbolic link and writes nothing to disk
- [ ] Work stays bounded: the limits of docs/limits.md hold, and a hostile test has a time check that widens under coverage through `NODE_V8_COVERAGE`
- [ ] A test that depends on the operating system (a link, a device, file permissions, a character a file name cannot hold) is guarded with `process.platform`, asserts no line of its own, and builds its paths with `resolve()` from forward-slash names
- [ ] No real product, schema, person or email address in fixtures or examples, no date, and no number that reads like a year anywhere
- [ ] The commit messages of this pull request follow Conventional Commits
