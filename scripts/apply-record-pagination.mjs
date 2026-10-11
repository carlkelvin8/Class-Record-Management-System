import { Client } from "pg";
import { readFile, writeFile, readdir } from "node:fs/promises";
const migration = process.argv[2] || "202610110006_record_pagination.sql";
if (!/^\d{12}_[a-z_]+\.sql$/.test(migration))
  throw Error("Invalid migration filename");
const version = migration.slice(0, 12);
const name = migration.slice(13, -4);
const sql = await readFile("supabase/migrations/" + migration, "utf8");
const cert = await (
  await fetch(
    "https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt",
  )
).text();
if (!process.env.MIGRATION_DATABASE_URL)
  throw Error("Set MIGRATION_DATABASE_URL to the database connection string.");
const client = new Client({
  connectionString: process.env.MIGRATION_DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: cert },
});
try {
  await client.connect();
  await client.query("begin");
  await client.query(
    "set local lock_timeout='10s'; set local statement_timeout='60s'; select pg_advisory_xact_lock(741900110)",
  );
  const applied = await client.query(
    "select version from supabase_migrations.schema_migrations where version=$1",
    [version],
  );
  if (!applied.rowCount) {
    await client.query(sql);
    await client.query(
      "insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2,$3)",
      [version, [sql], name],
    );
  }
  await client.query("notify pgrst,'reload schema'");
  await client.query("commit");
  console.log(name + " migration applied with verified TLS.");
} catch (e) {
  await client.query("rollback").catch(() => {});
  throw e;
} finally {
  await client.end();
}
const files = (await readdir("supabase/migrations")).sort();
const combined = await Promise.all(
  files.map((f) => readFile("supabase/migrations/" + f, "utf8")),
);
await writeFile(
  "docs/supabase-setup.sql",
  "-- Initial setup for an empty Supabase project.\n" + combined.join("\n\n"),
);
