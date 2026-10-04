# 1. Read no clock, and keep dates out of the repository

## Status

Accepted

## Context

An allow marker is often meant for a while: a migration that backfills every tenant until it has run, a report that
reads every tenant until a project replaces it. It is tempting to give a marker an end and check it against today: a
marker past its end would then stop allowing. Doing so would make the same SQL give a different result on a different
day, so a pipeline that passed yesterday could fail today with no change to the repository. It would also make the
tool read dates in every format a team writes them, and guess the time zone of the person who wrote them.

The checks that matter here do not need a date. Whether a query limits a tenant table to one tenant, whether an INSERT
sets the tenant column, whether a marker gives a reason: all of these can be read from the SQL as it is.

## Decision

1. The tool reads no clock, no time zone and no locale. The same SQL gives the same output on every machine and on
   every day.
2. A date in a reason is text like any other. The marker has no field for an end; a date written into a reason is not
   read.
3. No file of this repository holds a date or a number that reads like a year: not the licence, not the changelog, not
   the examples, not the documents. `npm run check` and a test fail on any number that reads like a year.

## Consequences

- A marker whose end has passed still allows its statement as long as it has a reason. The limits in docs/limits.md
  say so, and a team that wants an end removes the marker; `unused-allow` points at a marker once its statement no
  longer needs it.
- The output of a run can be saved in the repository (`examples/output`) and compared on every change, because it does
  not move with the calendar.
- The README, the documents and the examples can be read in any year without being out of date about a date.
