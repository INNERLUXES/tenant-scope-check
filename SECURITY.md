# Security

## Reporting a problem

Write to info@innerluxes.dev with the subject line "tenant-scope-check security", or use private vulnerability reporting on this repository. Please do not open a public issue for a vulnerability.

Include a small made-up SQL file and configuration that show the problem, the command you ran, what you expected and what happened. Use made-up tables and names, never the schema or the queries of a real product, and never a real key, token or password, even a revoked one.

## Scope

In scope:

- an input that makes the tool read a file other than the SQL files and the configuration it was given, follow a symbolic link, or read a file a pattern of the configuration leaves out
- an input that makes the tool open a network connection, connect to a database, fetch a web address, run a program, load a module or evaluate any part of a file
- an input that makes the tool write a file
- an input that makes the tool hang, take very long or use unbounded memory, such as a very large file, a very long line, very many statements, files or joins, long runs of quotes, dollar signs or comment marks, or parentheses nested very deep
- binary, UTF-16 or invalid UTF-8 input that the tool reads as if it were text
- an input that the tool fails to read and passes over without an error, such as a string or a comment that is not closed, or an unknown key or a key named twice in the configuration
- a run that passes although a query on a tenant table has no tenant condition every row must pass, or a rule runs or does not run against docs/method.md
- text from the SQL or a file name that rewrites the terminal through control or direction characters, starts or ends a GitHub workflow command, or is shown unescaped in the output
- a name such as `__proto__` that changes how objects behave inside the tool
- an output that changes with the clock, the time zone or the locale of the machine

Out of scope: the forms docs/limits.md says the tool does not read, whether the SQL in the repository is the SQL the application runs, whether the reason of an allow marker is a good one, who may change the SQL or the configuration in your repository, and where your pipeline keeps the output.

Read [docs/threat-model.md](docs/threat-model.md) for the rest.
