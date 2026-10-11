import { spawn } from "node:child_process";
const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw Error("Database tests run only against a local Supabase database.");
const child = spawn(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/database.test.ts",
    "--configLoader",
    "runner",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, DATABASE_URL: url },
  },
);
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
