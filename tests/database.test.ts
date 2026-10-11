import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { database, teacherA, teacherB, asTeacher } from "./db-harness";
import reference from "../src/lib/reference-config.json";
import { calculateTerm, calculateFinal } from "../src/lib/grading";
import type { Config, Grade } from "../src/lib/types";
const config = reference as Config;
const info = {
  school: "Synthetic School",
  school_id: "001234",
  region: "Sample",
  division: "Sample",
  teacher: "Synthetic Teacher",
  grade_level: "11",
  section: "Example A",
  school_year: "2026–2027",
  subject: "Life and Career Skills",
  cluster: "CORE",
  subject_category: "SSHS - CORE",
};
function payload() {
  return {
    class_id: null as string | null,
    expected_revision: null as number | null,
    strategy: "new",
    allow_missing_lrn: true,
    info,
    config,
    filename: "synthetic.xlsx",
    fingerprint: "synthetic-hash",
    learners: [
      {
        key: "L1",
        name: "Synthetic Learner One",
        lrn: "001234567890",
        sex: "male",
        enrollment_id: null as string | null,
      },
      {
        key: "L2",
        name: "Synthetic Learner Two",
        lrn: null,
        sex: "female",
        enrollment_id: null as string | null,
      },
    ],
    assessments: [
      {
        key: "WW",
        term: 1,
        category: "ww",
        subcomponent: null,
        name: "Written 1",
        maximum: 10,
      },
      {
        key: "PT",
        term: 1,
        category: "pt",
        subcomponent: null,
        name: "Performance 1",
        maximum: 10,
      },
      {
        key: "ST1",
        term: 1,
        category: "ex",
        subcomponent: "ST1",
        name: "ST1",
        maximum: 10,
      },
      {
        key: "ST2",
        term: 1,
        category: "ex",
        subcomponent: "ST2",
        name: "ST2",
        maximum: 10,
      },
      {
        key: "TE",
        term: 1,
        category: "ex",
        subcomponent: "TE",
        name: "TE",
        maximum: 10,
      },
    ],
    scores: [
      ...["WW", "PT", "ST1", "ST2", "TE"].map((key) => ({
        learner_key: "L1",
        assessment_key: key,
        value: 8 as number | null,
      })),
      { learner_key: "L2", assessment_key: "WW", value: 0 as number | null },
      { learner_key: "L2", assessment_key: "PT", value: null as number | null },
    ],
    provenance: [
      { kind: "score", key: "L1:WW", source: { sheet: "Term 1", cell: "D17" } },
    ],
  };
}
let db: PGlite, cid: string, bid: string, eid: string, aid: string;
async function call(p: ReturnType<typeof payload>, token = randomUUID()) {
  return (
    await db.query<{
      result: { class_id: string; batch_id: string; idempotent: boolean };
    }>("select public.import_class_record($1::jsonb,$2::uuid) result", [
      JSON.stringify(p),
      token,
    ])
  ).rows[0].result;
}
async function reimport() {
  const p = payload();
  p.class_id = cid;
  p.expected_revision = (
    await db.query<{ revision: number }>(
      "select revision from public.classes where id=$1",
      [cid],
    )
  ).rows[0].revision;
  p.strategy = "keep";
  const es = (
    await db.query<{ id: string; source_key: string }>(
      "select id,source_key from public.class_enrollments where class_id=$1",
      [cid],
    )
  ).rows;
  p.learners.forEach(
    (l) => (l.enrollment_id = es.find((e) => e.source_key === l.key)!.id),
  );
  return p;
}
beforeAll(async () => {
  db = await database();
  await db.exec(
    "insert into auth.users(id) values ('" +
      teacherA +
      "'),('" +
      teacherB +
      "');",
  );
  await asTeacher(db, teacherA);
  const r = await call(payload());
  cid = r.class_id;
  bid = r.batch_id;
  eid = (
    await db.query<{ id: string }>(
      "select id from public.class_enrollments where class_id=$1 and source_key='L1'",
      [cid],
    )
  ).rows[0].id;
  aid = (
    await db.query<{ id: string }>(
      "select id from public.assessments where class_id=$1 and source_key='WW'",
      [cid],
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe("PostgreSQL authoritative grading", () => {
  it("supports manual learner, assessment and score CRUD with scoped deletion", async () => {
    await asTeacher(db, teacherA);
    const temp = (await call(payload())).class_id;
    const revision = async () =>
      (
        await db.query<{ revision: number }>(
          "select revision from public.classes where id=$1",
          [temp],
        )
      ).rows[0].revision;
    const manage = async (action: string, data: unknown) =>
      (
        await db.query<{ id: string }>(
          "select public.manage_record($1,$2,$3,$4::jsonb) id",
          [temp, await revision(), action, JSON.stringify(data)],
        )
      ).rows[0].id;
    const learner = await manage("learner", {
      name: "Manual Synthetic Learner",
      lrn: null,
      sex: "unspecified",
    });
    await manage("learner", {
      id: learner,
      name: "Updated Synthetic Learner",
      lrn: "999999999999",
      sex: "male",
    });
    expect(
      (
        await db.query<{ name: string }>(
          "select name from public.class_enrollments where id=$1",
          [learner],
        )
      ).rows[0].name,
    ).toBe("Updated Synthetic Learner");
    const term = (
      await db.query<{ id: string }>(
        "select id from public.terms where class_id=$1 and number=1",
        [temp],
      )
    ).rows[0].id;
    const category = (
      await db.query<{ id: string }>(
        "select id from public.assessment_categories where class_id=$1 and code='ww'",
        [temp],
      )
    ).rows[0].id;
    const assessment = await manage("assessment", {
      name: "Manual Quiz",
      maximum: 10,
      term_id: term,
      category_id: category,
      subcomponent: null,
    });
    await db.query("select public.save_score($1,$2,$3,8,null)", [
      temp,
      learner,
      assessment,
    ]);
    await manage("assessment", {
      id: assessment,
      name: "Updated Quiz",
      maximum: 12,
      term_id: term,
      category_id: category,
      subcomponent: null,
    });
    await expect(
      manage("assessment", {
        id: assessment,
        name: "Quiz",
        maximum: 5,
        term_id: term,
        category_id: category,
        subcomponent: null,
      }),
    ).rejects.toThrow(/Maximum below/);
    const rev = await revision();
    await expect(
      db.query("select public.delete_record($1,$2,'assessment',$3)", [
        temp,
        rev - 1,
        assessment,
      ]),
    ).rejects.toThrow(/Class changed/);
    await expect(
      db.query("select public.delete_record($1,$2,'learner',$3)", [
        temp,
        rev,
        eid,
      ]),
    ).rejects.toThrow(/not found in this class/);
    await asTeacher(db, teacherB);
    await expect(
      db.query("select public.delete_record($1,$2,'assessment',$3)", [
        temp,
        rev,
        assessment,
      ]),
    ).rejects.toThrow(/access denied/);
    await asTeacher(db, teacherA);
    await db.query("select public.delete_record($1,$2,'assessment',$3)", [
      temp,
      rev,
      assessment,
    ]);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.scores where assessment_id=$1",
          [assessment],
        )
      ).rows[0].n,
    ).toBe(0);
    const another = (
      await db.query<{ id: string }>(
        "select id from public.assessments where class_id=$1 limit 1",
        [temp],
      )
    ).rows[0].id;
    await db.query("select public.save_score($1,$2,$3,4,null)", [
      temp,
      learner,
      another,
    ]);
    await db.query("select public.delete_record($1,$2,'learner',$3)", [
      temp,
      await revision(),
      learner,
    ]);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.scores where enrollment_id=$1",
          [learner],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.class_enrollments where id=$1",
          [learner],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("paginates, filters and sorts globally while bounding score reads", async () => {
    const page = async (
      n = 0,
      search = "",
      sort = "learner",
      desc = false,
      final = false,
    ) =>
      (
        await db.query<{
          result: {
            total: number;
            page: number;
            learners: { id: string; name: string }[];
            scores: { enrollment_id: string }[];
            termGrades: { enrollment_id: string; number: number }[];
          };
        }>("select public.record_page($1,$2,1,$3,'all',$4,$5,1,$6) result", [
          cid,
          n,
          search,
          sort,
          desc,
          final,
        ])
      ).rows[0].result;
    const first = await page(),
      second = await page(1);
    expect(first.total).toBe(2);
    expect(first.learners).toHaveLength(1);
    expect(second.learners).toHaveLength(1);
    expect(first.learners[0].id).not.toBe(second.learners[0].id);
    expect(
      first.scores.every((s) => s.enrollment_id === first.learners[0].id),
    ).toBe(true);
    expect(
      first.termGrades.every(
        (g) => g.number === 1 && g.enrollment_id === first.learners[0].id,
      ),
    ).toBe(true);
    expect((await page(0, "", "learner", true)).learners[0].id).toBe(
      second.learners[0].id,
    );
    expect((await page(10)).page).toBe(1);
    expect((await page(0, "001234567890")).learners[0].id).toBe(eid);
    expect((await page(0, "%_nothing")).total).toBe(0);
    expect((await page(0, "nothing")).learners).toEqual([]);
    expect((await page(0, "", "grade", true)).learners[0].id).toBe(eid);
    const finals = await page(0, "", "learner", false, true);
    expect(finals.scores).toEqual([]);
    expect(finals.termGrades).toHaveLength(3);
    await expect(
      db.query("select public.record_page($1,0,101)", [cid]),
    ).rejects.toThrow(/Invalid pagination/);
    await asTeacher(db, teacherB);
    await expect(
      db.query("select public.record_page($1)", [cid]),
    ).rejects.toThrow(/access denied/);
    await asTeacher(db, teacherA);
  });
  it("runs all migrations and produces correct grades and incomplete finals", async () => {
    const grades = (
      await db.query<{ number: number; result: Grade }>(
        "select number,result from public.term_grades where enrollment_id=$1 order by number",
        [eid],
      )
    ).rows;
    expect(grades).toHaveLength(3);
    expect(grades[0].result.grade).toBe(83);
    expect(grades[0].result.initial).toBe(80);
    expect(grades[1].result.incomplete).toBe(true);
    const f = (
      await db.query<{ result: { final: null; incomplete: boolean } }>(
        "select result from public.final_grades where enrollment_id=$1",
        [eid],
      )
    ).rows[0].result;
    expect(f.final).toBeNull();
    expect(f.incomplete).toBe(true);
  });
  it("matches frontend staged rounding, blank behavior, zero and ceiling boundaries", async () => {
    const aa = [
      { category: "ww" as const, subcomponent: null, maximum: 138 },
      { category: "pt" as const, subcomponent: null, maximum: 96 },
      { category: "ex" as const, subcomponent: "ST1" as const, maximum: 30 },
      { category: "ex" as const, subcomponent: "ST2" as const, maximum: 30 },
      { category: "ex" as const, subcomponent: "TE" as const, maximum: 60 },
    ];
    for (const values of [
      [126, 80, 19, 29, 58],
      [0, 0, 0, 0, 0],
      [null, 80, 19, null, 58],
      [126, 80, 19, null, 58],
    ]) {
      const inputs = aa.map((a, i) => ({ ...a, value: values[i] }));
      const sql = (
        await db.query<{ g: Grade }>(
          "select public.grade_rules($1::jsonb,$2::jsonb) g",
          [JSON.stringify(config), JSON.stringify(inputs)],
        )
      ).rows[0].g;
      const js = calculateTerm(config, aa, values);
      expect(sql).toEqual(js);
    }
    const c = {
      ...config,
      weights: { ww: 50, pt: 50, ex: 0 },
      subweights: { ST1: 0, ST2: 0, TE: 0 },
    };
    for (const r of config.ranges) {
      for (const v of [r.upper, r.upper + 0.01]) {
        const inputs = [
          { category: "ww", subcomponent: null, maximum: 100, value: v },
          { category: "pt", subcomponent: null, maximum: 100, value: v },
        ];
        const g = (
          await db.query<{ g: Grade }>(
            "select public.grade_rules($1::jsonb,$2::jsonb) g",
            [JSON.stringify(c), JSON.stringify(inputs)],
          )
        ).rows[0].g;
        expect(g).toEqual(
          calculateTerm(c, inputs as Parameters<typeof calculateTerm>[1], [
            v,
            v,
          ]),
        );
      }
    }
  });
  it("matches final grades for one, two and three applicable terms and missing LRNs", async () => {
    for (const ts of [[2], [2, 3], [1, 2, 3]]) {
      const c = {
        ...config,
        applicable_terms: ts,
        units_per_year: ts.length * 2,
      };
      const grades = ts.map((t, i) => ({
        ...calculateTerm(c, [], []),
        grade: 80 + i * 5,
        incomplete: false,
        provisional: false,
      }));
      for (const lrn of ["001234567890", null]) {
        const g = (
          await db.query<{ g: unknown }>(
            "select public.final_rules($1::jsonb,$2::jsonb,$3::text) g",
            [JSON.stringify(c), JSON.stringify(grades), lrn],
          )
        ).rows[0].g;
        expect(g).toEqual(
          calculateFinal(c, new Map(ts.map((t, i) => [t, grades[i]])), lrn),
        );
      }
    }
  });
});
describe("transactional imports and score conflicts", () => {
  it("rolls back a failure after rows have started inserting", async () => {
    const n = (
      await db.query<{ n: number }>(
        "select count(*)::int n from public.classes",
      )
    ).rows[0].n;
    const p = payload();
    p.scores[p.scores.length - 1].value = 11;
    await expect(call(p)).rejects.toThrow("Score outside limits");
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.classes",
        )
      ).rows[0].n,
    ).toBe(n);
  });
  it("is idempotent and rejects changed payload with the same token", async () => {
    const token = randomUUID(),
      p = payload();
    const one = await call(p, token),
      two = await call(p, token);
    expect(one.class_id).toBe(two.class_id);
    expect(two.idempotent).toBe(true);
    p.filename = "changed.xlsx";
    await expect(call(p, token)).rejects.toThrow("different payload");
  });
  it("rejects missing-LRN imports without explicit confirmation, duplicate LRNs and duplicate scores", async () => {
    const p = payload();
    p.allow_missing_lrn = false;
    await expect(call(p)).rejects.toThrow("confirmation");
    p.allow_missing_lrn = true;
    p.learners[1].lrn = p.learners[0].lrn;
    await expect(call(p)).rejects.toThrow("Duplicate LRNs");
    const q = payload();
    q.scores.push(q.scores[0]);
    await expect(call(q)).rejects.toThrow("Duplicate score");
  });
  it("requires explicit consent for distinct learners with identical names", async () => {
    const p = payload();
    p.learners[1].name = p.learners[0].name;
    await expect(call(p)).rejects.toThrow("distinct-learner confirmation");
    const result = await call({
      ...p,
      allow_duplicate_names: true,
    } as ReturnType<typeof payload>);
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.class_enrollments where class_id=$1",
          [result.class_id],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it("rejects invalid config, unknown score references and ownership spoofing", async () => {
    const p = payload();
    p.config = { ...config, weights: { ww: 20, pt: 50, ex: 20 } };
    await expect(call(p)).rejects.toThrow("Weights");
    const q = payload();
    q.scores[0].learner_key = "UNKNOWN";
    await expect(call(q)).rejects.toThrow("missing learner");
    const r = await call({ ...payload(), owner_id: teacherB } as ReturnType<
      typeof payload
    >);
    expect(
      (
        await db.query<{ owner_id: string }>(
          "select owner_id from public.classes where id=$1",
          [r.class_id],
        )
      ).rows[0].owner_id,
    ).toBe(teacherA);
  });
  it("rejects stale score edits and updates versions authoritatively", async () => {
    const old = (
      await db.query<{ version: number }>(
        "select version from public.scores where enrollment_id=$1 and assessment_id=$2",
        [eid, aid],
      )
    ).rows[0];
    await db.query("select public.save_score($1,$2,$3,$4,$5)", [
      cid,
      eid,
      aid,
      7,
      old.version,
    ]);
    await expect(
      db.query("select public.save_score($1,$2,$3,$4,$5)", [
        cid,
        eid,
        aid,
        6,
        old.version,
      ]),
    ).rejects.toThrow("another session");
    expect(
      (
        await db.query<{ value: number }>(
          "select value from public.scores where enrollment_id=$1 and assessment_id=$2",
          [eid, aid],
        )
      ).rows[0].value,
    ).toBe("7");
  });
  it("requires explicit learner mapping and refuses stale class/config/max conflicts", async () => {
    const p = await reimport();
    p.learners[0].enrollment_id = null;
    await expect(call(p)).rejects.toThrow("explicitly mapped");
    const q = await reimport();
    q.expected_revision = -1;
    await expect(call(q)).rejects.toThrow("changed since preview");
    const r = await reimport();
    r.config = { ...config, passing_threshold: 76 };
    await expect(call(r)).rejects.toThrow("Grading configuration conflict");
    const a = await reimport();
    a.assessments[0].maximum = 20;
    await expect(call(a)).rejects.toThrow("Assessment definition conflict");
  });
  it("applies keep/fill/replace explicitly, preserves learners, and handles incoming blanks", async () => {
    let p = await reimport();
    p.scores[0].value = 5;
    await call(p);
    expect(
      (
        await db.query<{ value: string }>(
          "select value from public.scores where enrollment_id=$1 and assessment_id=$2",
          [eid, aid],
        )
      ).rows[0].value,
    ).toBe("7");
    p = await reimport();
    p.strategy = "fill";
    p.scores[0].value = 4;
    await call(p);
    expect(
      (
        await db.query<{ value: string }>(
          "select value from public.scores where enrollment_id=$1 and assessment_id=$2",
          [eid, aid],
        )
      ).rows[0].value,
    ).toBe("7");
    p = await reimport();
    p.strategy = "replace";
    p.scores[0].value = null;
    await call(p);
    expect(
      (
        await db.query<{ value: null }>(
          "select value from public.scores where enrollment_id=$1 and assessment_id=$2",
          [eid, aid],
        )
      ).rows[0].value,
    ).toBeNull();
    p = await reimport();
    p.strategy = "fill";
    p.scores[0].value = 0;
    await call(p);
    expect(
      (
        await db.query<{ value: string }>(
          "select value from public.scores where enrollment_id=$1 and assessment_id=$2",
          [eid, aid],
        )
      ).rows[0].value,
    ).toBe("0");
    expect(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from public.class_enrollments where class_id=$1",
          [cid],
        )
      ).rows[0].n,
    ).toBe(2);
  });
});
describe("teacher isolation, RPC permissions and private Storage", () => {
  it("denies cross-teacher reads of every child table and grading view, plus score/import RPCs", async () => {
    await asTeacher(db, teacherB);
    for (const t of [
      "classes",
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
    ]) {
      const key = t === "classes" ? "id" : "class_id";
      expect(
        (
          await db.query(
            "select * from public." + t + " where " + key + "=$1",
            [cid],
          )
        ).rows,
      ).toEqual([]);
    }
    await expect(
      db.query("select public.save_score($1,$2,$3,1,1)", [cid, eid, aid]),
    ).rejects.toThrow("access denied");
    const p = payload();
    p.class_id = cid;
    p.strategy = "keep";
    p.expected_revision = 0;
    await expect(call(p)).rejects.toThrow("access denied");
    await asTeacher(db, teacherA);
  });
  it("denies direct child writes and anonymous RPC execution", async () => {
    await expect(
      db.query("update public.scores set value=1 where class_id=$1", [cid]),
    ).rejects.toThrow("permission denied");
    await db.exec("set role anon");
    await expect(call(payload())).rejects.toThrow("permission denied");
    await asTeacher(db, teacherA);
  });
  it("allows owner Storage access and denies cross-teacher forged paths", async () => {
    const name = teacherA + "/" + cid + "/" + bid + "/synthetic.xlsx";
    await db.query(
      "insert into storage.objects(bucket_id,name) values('workbooks',$1)",
      [name],
    );
    expect(
      (await db.query("select name from storage.objects where name=$1", [name]))
        .rows,
    ).toHaveLength(1);
    await asTeacher(db, teacherB);
    expect(
      (await db.query("select name from storage.objects where name=$1", [name]))
        .rows,
    ).toHaveLength(0);
    await expect(
      db.query(
        "insert into storage.objects(bucket_id,name) values('workbooks',$1)",
        [teacherB + "/" + cid + "/" + bid + "/forged.xlsx"],
      ),
    ).rejects.toThrow("row-level security");
    await expect(
      db.query(
        "insert into storage.objects(bucket_id,name) values('workbooks',$1)",
        [name + "extra"],
      ),
    ).rejects.toThrow("row-level security");
    await asTeacher(db, teacherA);
    await db.exec("reset role");
    expect(
      (
        await db.query<{ public: boolean }>(
          "select public from storage.buckets where id='workbooks'",
        )
      ).rows[0]?.public,
    ).toBe(false);
  });
  it("ignores zero-weight components and blank zero-weight exam subcomponents", async () => {
    await asTeacher(db, teacherA);
    const cases: {
      weights: Config["weights"];
      subweights: Config["subweights"];
      inputs: {
        category: "ww" | "pt" | "ex";
        subcomponent: "ST1" | "ST2" | "TE" | null;
        maximum: number;
        value: number | null;
      }[];
    }[] = [
      {
        weights: { ww: 100, pt: 0, ex: 0 },
        subweights: config.subweights,
        inputs: [{ category: "ww", subcomponent: null, maximum: 10, value: 8 }],
      },
      {
        weights: { ww: 0, pt: 100, ex: 0 },
        subweights: config.subweights,
        inputs: [{ category: "pt", subcomponent: null, maximum: 10, value: 8 }],
      },
      {
        weights: { ww: 0, pt: 0, ex: 100 },
        subweights: { ST1: 0, ST2: 0, TE: 100 },
        inputs: [
          { category: "ex", subcomponent: "ST1", maximum: 10, value: null },
          { category: "ex", subcomponent: "TE", maximum: 10, value: 8 },
        ],
      },
    ];
    for (const scenario of cases) {
      const c = {
        ...config,
        resolved: true,
        weights: scenario.weights,
        subweights: scenario.subweights,
      };
      const js = calculateTerm(
        c,
        scenario.inputs,
        scenario.inputs.map((i) => i.value),
      );
      const sql = (
        await db.query<{ result: Grade }>(
          "select public.grade_rules($1::jsonb,$2::jsonb) as result",
          [JSON.stringify(c), JSON.stringify(scenario.inputs)],
        )
      ).rows[0].result;
      expect(sql).toEqual(js);
      expect(js.initial).toBe(80);
      expect(js.grade).not.toBeNull();
      expect(js.incomplete).toBe(false);
    }
  });
});
