import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const url = process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const dbUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!key || key.includes("replace_"))
  throw Error(
    "Set the local Supabase publishable key in .env.local before running test:api.",
  );
for (const address of [url, dbUrl])
  if (!["localhost", "127.0.0.1"].includes(new URL(address).hostname))
    throw Error("API smoke tests only run against local Supabase.");
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const a = createClient(url, key, opts),
  b = createClient(url, key, opts);
const sql = new Client({ connectionString: dbUrl });
let cid, objectPath, uid;
const check = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const rows = async (client, table, id) =>
  check(await client.from(table).select("*").eq("class_id", id));
try {
  await sql.connect();
  const login = check(
    await a.auth.signInWithPassword({
      email: "teacher@example.test",
      password: "DemoClass123!",
    }),
  );
  uid = login.user.id;
  check(
    await b.auth.signInWithPassword({
      email: "other.teacher@example.test",
      password: "DemoClass123!",
    }),
  );
  const reference = JSON.parse(
    await readFile(
      new URL("../src/lib/reference-config.json", import.meta.url),
      "utf8",
    ),
  );
  const config = { ...reference, applicable_terms: [1], units_per_year: 2 };
  const payload = {
    class_id: null,
    expected_revision: null,
    strategy: "new",
    allow_missing_lrn: true,
    filename: "synthetic-smoke.csv",
    fingerprint: "local-smoke-" + randomUUID(),
    info: {
      school: "Synthetic Test School",
      school_id: "000000",
      region: "Example",
      division: "Example",
      teacher: "Demo Teacher",
      grade_level: "11",
      section: "API Smoke",
      school_year: "2026–2027",
      subject: "Life and Career Skills",
      cluster: "CORE",
      subject_category: "SSHS - CORE",
    },
    config,
    learners: [
      {
        key: "L1",
        name: "Synthetic Smoke Learner",
        lrn: "000000000099",
        sex: "male",
        enrollment_id: null,
      },
    ],
    assessments: [
      ["ww", null, "WW"],
      ["pt", null, "PT"],
      ["ex", "ST1", "ST1"],
      ["ex", "ST2", "ST2"],
      ["ex", "TE", "TE"],
    ].map(([category, subcomponent, name]) => ({
      key: name,
      term: 1,
      category,
      subcomponent,
      name,
      maximum: 10,
    })),
    scores: ["WW", "PT", "ST1", "ST2", "TE"].map((key) => ({
      learner_key: "L1",
      assessment_key: key,
      value: 8,
    })),
    provenance: [
      { kind: "score", key: "L1:WW", source: { sheet: "CSV", cell: "WW2" } },
    ],
  };
  const token = randomUUID();
  const result = check(
    await a.rpc("import_class_record", { payload, confirmation_token: token }),
  );
  cid = result.class_id;
  const repeat = check(
    await a.rpc("import_class_record", { payload, confirmation_token: token }),
  );
  assert.equal(repeat.class_id, cid);
  assert.equal(repeat.idempotent, true);
  const ls = await rows(a, "class_enrollments", cid),
    aa = await rows(a, "assessments", cid),
    scores = await rows(a, "scores", cid);
  assert.equal(ls[0].lrn, "000000000099");
  assert.equal(scores.length, 5);
  const grades = await rows(a, "term_grades", cid);
  assert.equal(grades[0].result.initial, 80);
  assert.equal(grades[0].result.grade, 83);
  const finals = await rows(a, "final_grades", cid);
  assert.equal(finals[0].result.final, 83);
  assert.equal(finals[0].result.remark, "PASSED");
  const assessment = aa.find((x) => x.source_key === "WW"),
    score = scores.find((s) => s.assessment_id === assessment.id);
  const edit = {
    p_class: cid,
    p_enrollment: ls[0].id,
    p_assessment: assessment.id,
    p_value: 6,
    p_expected_version: score.version,
  };
  check(await a.rpc("save_score", edit));
  assert.ok((await a.rpc("save_score", { ...edit, p_value: 5 })).error);
  assert.equal((await rows(a, "term_grades", cid))[0].result.initial, 76);
  for (const table of [
    "class_enrollments",
    "terms",
    "assessment_categories",
    "assessments",
    "scores",
    "grading_configurations",
    "transmutation_ranges",
    "descriptors",
    "import_batches",
    "import_provenance",
    "term_grades",
    "final_grades",
  ])
    assert.equal((await rows(b, table, cid)).length, 0);
  assert.ok(
    (await b.rpc("save_score", { ...edit, p_expected_version: 2 })).error,
  );
  const before = check(await a.from("classes").select("id")).length;
  const invalid = structuredClone(payload);
  invalid.scores[4].value = 11;
  assert.ok(
    (
      await a.rpc("import_class_record", {
        payload: invalid,
        confirmation_token: randomUUID(),
      })
    ).error,
  );
  assert.equal(check(await a.from("classes").select("id")).length, before);
  objectPath = uid + "/" + cid + "/" + result.batch_id + "/synthetic.csv";
  check(
    await a.storage
      .from("workbooks")
      .upload(
        objectPath,
        new Blob(["Name,Score\nSynthetic,8\n"], { type: "text/csv" }),
        { contentType: "text/csv" },
      ),
  );
  assert.ok((await b.storage.from("workbooks").download(objectPath)).error);
  assert.ok(
    (await b.storage.from("workbooks").createSignedUrl(objectPath, 60)).error,
  );
  const signed = check(
    await a.storage.from("workbooks").createSignedUrl(objectPath, 60),
  );
  assert.equal((await fetch(signed.signedUrl)).ok, true);
  const expiry = check(
    await a.storage.from("workbooks").createSignedUrl(objectPath, 1),
  );
  await new Promise((r) => setTimeout(r, 2100));
  assert.equal(
    (await fetch(expiry.signedUrl + "&cacheBust=" + Date.now())).ok,
    false,
  );
  console.log(
    "Local API smoke passed: Auth, import, idempotency, rollback, edits, grading, teacher isolation, private Storage and signed URL expiry.",
  );
} finally {
  if (objectPath) await a.storage.from("workbooks").remove([objectPath]);
  if (cid && uid)
    await sql.query("delete from public.classes where id=$1 and owner_id=$2", [
      cid,
      uid,
    ]);
  await a.auth.signOut();
  await b.auth.signOut();
  await sql.end();
}
