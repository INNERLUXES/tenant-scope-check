# 2. Read SQL with a tokenizer, not a full parser

## Status

Accepted

## Context

A check of tenant conditions needs to know, for each query, which tables it reads or changes and which conditions
every row must pass. A full SQL parser gives that exactly, but there are many dialects, each with a grammar of
hundreds of rules, and a parser that does not know one form of one dialect fails on the whole file. A run that fails
on valid SQL is a run teams switch off. A parser library would also be a dependency, and this tool keeps none.

A regular expression over the text is the other end: it is small, but a semicolon or a quote inside a string, a
comment or a dollar-quoted function body moves every match after it, and a condition inside a subquery looks like a
condition of the outer query.

What decides the answer is smaller than a grammar: where strings, quoted names, comments and statements start and end,
where parentheses open and close, and, inside a query, the FROM list, the JOIN conditions and the parts of WHERE joined
by AND. Those follow the lexical rules that PostgreSQL documents and that most dialects share.

## Decision

1. The reader is a tokenizer that knows strings with a doubled quote, escape strings, dollar quotes, quoted
   identifiers, line comments, nested block comments and parameters, and nothing more. It splits statements at
   semicolons, waiting for the END of a BEGIN ATOMIC body, and makes a group of each pair of parentheses.
2. Over the tokens, a small reader finds the parts of a query that decide which rows it touches: WITH, the FROM list
   with its joins, WHERE, the target of UPDATE, DELETE and INSERT, the column list of INSERT, subqueries and set
   operations. Everything else in a statement is passed over.
3. Text the tokenizer cannot place, a string, a quoted name, a dollar quote or a comment that is not closed, or a
   parenthesis that is not matched, stops the run with exit code `2`. A run never passes because the rest of a file
   was read as one long string.
4. What the reader cannot see is written down in docs/limits.md: SQL built at run time, ORMs, views, functions,
   row-level security policies, schemas, and the forms it does not read.

## Consequences

- The tool reads the SQL of PostgreSQL, MySQL and SQLite, and the files of query tools, without a dialect setting,
  and fails only on text that no SQL reader could place.
- An unusual form can be read as something it is not. A finding names the table and the line, so a reader can check
  it, and an allow marker with a reason settles a finding the tool gets wrong.
- The reader has no dependency, runs in one pass over each file, and is covered by tests of each lexical form and of
  hostile input.
