# Threat model

## What the tool touches

- It reads the files and folders named on the command line and the configuration file named with `--config`. In a
  folder it opens only the files whose path matches the patterns of the configuration. Nothing else is opened.
- It writes the report to standard output and its errors to standard error. It writes nothing to disk.
- It opens no network connection, connects to no database, follows no symbolic link, evaluates nothing it reads and
  starts no program.

## What the input may hold

SQL files live in a repository that many people change. In a pipeline that checks every pull request, the SQL is
written by whoever opened the pull request, and so is the configuration.

Through the inputs, a person can try to:

- make the tool read another file: a file or a folder named through a symbolic link that points at a key file, a link
  inside a folder, a file swapped for a link between the walk and the read, a path with `..` in a pattern;
- make the tool fetch something: a path written as a web address;
- make a leaky query pass: a tenant condition under an OR, a tenant condition in the ON of a LEFT JOIN on the side the
  join keeps whole, a tenant condition on a global table, a semicolon or a quote inside a string or a comment that
  hides a statement, a string that is never closed so the rest of the file is read as text, an allow marker with a
  reason of TBD;
- move the result through the configuration: a key named twice, an unknown key that looks like a known one
  (`tenantColumn` for `tenantColumns`), a rule set to off, a table moved to `globalTables`, a pattern in `exclude` that
  leaves the queries out;
- exhaust the memory or the time: thousands of files, a file of gigabytes, a line of megabytes, long runs of quotes,
  dollar signs, comment marks and parentheses, a join of hundreds of tables;
- slip in something that is not text: a binary file named `.sql`, a file in UTF-16, bytes that are not UTF-8;
- rewrite the terminal or break the output: control characters, ANSI escapes, direction controls and line separators
  in a file name, a table name or a reason;
- start a second workflow command: a text that holds `::error`, `%`, a comma, a colon or a line break, which the
  GitHub format writes into a command;
- change how objects behave: a table, a column or an alias named `__proto__`, `constructor` or `toString`;
- make the output change from day to day: a date in a reason.

## What could go wrong, and what stops it

| Risk | Control |
| --- | --- |
| A symbolic link makes the tool read another file | A path named on the command line is looked at without following a link, and a link is refused; inside a folder a link is skipped and counted; each file is opened with `O_NOFOLLOW` where the system has it and its type is taken from the open handle, so a file swapped for a link is refused. A test names a file and the configuration through a link and puts links in a folder |
| The tool fetches a web address | No module of the network is imported; a path that looks like an address is refused. A test checks the imports of src |
| A leaky query passes | Only conditions every row must pass count: OR, NOT and the kept side of an outer join are left out; a global table passes nothing on; strings, dollar quotes, quoted names and comments are read as such, so text inside them is never SQL; a string, a name, a dollar quote or a comment that is not closed, or a parenthesis that is not matched, stops the run with exit code `2`; a marker with a reason that says nothing allows nothing and is an error |
| A key named twice or an unknown key moves the result | The JSON reader refuses a repeated key; an unknown key stops the run with its line and a suggestion; a table in both `tenantTables` and `globalTables` is refused; removing an entry that is not on a list and adding one that is are refused |
| The configuration leaves files out | `exclude` is a key like any other; a folder in which no file matches is an error, and the report lists the patterns and the number of files read. Review a change to `files` and `exclude` like a change to code (docs/secure-defaults.md) |
| The memory or the time is exhausted | Files have size limits checked on the open handle before they are read, and a run has limits on its files, its bytes and the entries it walks; the tokenizer reads each character once, finds the end of a string or a dollar quote with one search, and counts its tokens and the depth of parentheses; joins are worked out over maps and sets; findings are capped per rule. Tests check the time, with limits that widen under coverage only |
| A pattern from the input is slow | No regular expression is built from the SQL or the configuration; file patterns are matched by hand with work bounded by the product of their lengths; a test looks for `new RegExp` in src |
| A binary or UTF-16 file is read as text | A null byte, a UTF-16 byte order mark or bytes that are not valid UTF-8 stop the run with exit code `2` |
| Text from the input rewrites the terminal | Every text, file names included, goes through `safeText`, which removes control, line separator and direction characters and caps the length. A test puts ANSI escapes and direction controls in a file name, a table name and a reason, in every format |
| A text starts a second workflow command | The GitHub format escapes `%`, CR and LF in a message and `:` and `,` in a property; a line break never reaches a command. A test writes `%` into a reason and a comma and a colon into the file name |
| `__proto__` changes how objects behave | The JSON reader defines own properties; tables, columns and aliases are looked up in `Map` and in arrays, never as keys of a plain object. A test uses `__proto__`, `constructor`, `toString`, `hasOwnProperty` and `valueOf` as names |
| A device or a pipe hangs the tool | A path that is not a regular file or a folder is refused before it is read, and a walk reads regular files only |
| The tool leaves files behind | Nothing is written to disk; there is no cache, no temporary file and no log. A test checks that a run leaves the folder as it was |
| The output changes with the clock | The tool reads no clock, no time zone and no locale ([decision 1](decisions/0001-read-no-clock-and-keep-dates-out-of-the-repository.md)) |

## Out of scope

Whether the SQL the tool reads is the SQL the application runs, whether the value compared to the tenant column is
the tenant of the signed-in user, whether the reason of an allow marker is a good one, who may change the SQL or the
configuration in your repository, and where your pipeline keeps the output.
