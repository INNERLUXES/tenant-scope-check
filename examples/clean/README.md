# A clean set

The made-up migrations and queries of a made-up project tracker, Larkspur Boards, in which every customer company is
a tenant and all tenants share one PostgreSQL database. Plans and tenants are global tables; every other table carries
`tenant_id` and starts its primary key with it. Every query compares `tenant_id` to a parameter, or ties it to the
tenant column of a table that does; the audit log takes its tenant from a column default; and the one query that reads
every tenant, the billing count, carries an allow marker with its reason.

The tool finds nothing in it, with the built-in configuration and with `examples/config.json`.
