import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
export async function database() {
  if (process.env.DATABASE_URL) {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("begin");
    const adapter = {
      query: async <T>(q: string, params?: unknown[]) => {
        await client.query("savepoint check_statement");
        try {
          const r = await client.query(q, params);
          await client.query("release savepoint check_statement");
          return { rows: r.rows as T[] };
        } catch (e) {
          await client.query("rollback to savepoint check_statement");
          await client.query("release savepoint check_statement");
          throw e;
        }
      },
      exec: async (q: string) => {
        await client.query("savepoint check_statement");
        try {
          await client.query(q);
          await client.query("release savepoint check_statement");
        } catch (e) {
          await client.query("rollback to savepoint check_statement");
          await client.query("release savepoint check_statement");
          throw e;
        }
      },
      close: async () => {
        await client.query("rollback");
        await client.end();
      },
    };
    return adapter as unknown as PGlite;
  }
  const db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create schema storage;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,public,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text references storage.buckets(id),name text not null,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;",
  );
  for (const f of (await readdir("supabase/migrations")).sort()) {
    try {
      await db.exec(await readFile("supabase/migrations/" + f, "utf8"));
    } catch (e) {
      throw new Error(f + ": " + (e as Error).message);
    }
  }
  return db;
}
export const teacherA = "11111111-1111-4111-8111-111111111111",
  teacherB = "22222222-2222-4222-8222-222222222222";
export async function asTeacher(db: PGlite, id: string) {
  await db.exec(
    "reset role;select set_config('request.jwt.claim.sub','" +
      id +
      "',false);set role authenticated;",
  );
}
