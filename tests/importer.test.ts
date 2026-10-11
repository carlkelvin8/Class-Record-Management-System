import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  parseWorkbook,
  validateDraft,
  readCsv,
  mapCsv,
  compareEvidence,
} from "../src/lib/importer";
import {
  calculateTerm,
  calculateFinal,
  round,
  validateConfig,
} from "../src/lib/grading";
import reference from "../src/lib/reference-config.json";
import type { Config, ImportDraft, Grade } from "../src/lib/types";
import { importChanges, buildPayload } from "../src/lib/import-plan";
const config = reference as Config;
function book() {
  const wb = XLSX.utils.book_new();
  for (const name of [
    "INSTRUCTIONS",
    "INPUT DATA",
    "Term 1",
    "Term 2",
    "Term 3",
    "FINAL GRADES",
    "HELPER",
  ])
    XLSX.utils.book_append_sheet(wb, {}, name);
  const set = (sheet: string, cell: string, value: string | number) =>
    (wb.Sheets[sheet][cell] = {
      t: typeof value === "number" ? "n" : "s",
      v: value,
    });
  for (const [cell, v] of Object.entries({
    F14: "Synthetic School",
    F13: "001234",
    F10: "Sample Region",
    F11: "Sample Division",
    F22: "Demo Teacher",
    F24: 11,
    F25: "Sample A",
    F16: 2026,
    F28: "SSHS - CORE",
    F29: "CORE",
    F30: "Life and Career Skills",
    H33: "FIRST TERM",
    O11: "Example, Learner One",
    N11: "001234567890",
    S11: "Example, Learner Two",
  }))
    set("INPUT DATA", cell, v);
  for (const [cell, v] of Object.entries({
    J10: "SSHS - CORE",
    K10: "CORE",
    L10: "Life and Career Skills",
    N10: "11 ",
    P10: 3,
    Q10: 2,
    R10: 6,
    W10: 20,
    X10: 50,
    Y10: 30,
    AA10: 30,
    AB10: 30,
    AC10: 40,
  }))
    set("HELPER", cell, v);
  config.ranges.forEach((r, i) => {
    set("HELPER", "B" + (i + 7), r.lower);
    set("HELPER", "C" + (i + 7), r.upper);
    set("HELPER", "D" + (i + 7), r.grade);
  });
  config.descriptors.forEach((d, i) => {
    set("HELPER", "AG" + (i + 7), d.grade);
    set("HELPER", "AH" + (i + 7), d.label);
  });
  for (const [cell, v] of Object.entries({
    D14: 10,
    Q14: 10,
    AD14: 10,
    AE14: 10,
    AF14: 10,
    D13: 1,
    Q13: 1,
    D17: 0,
    Q17: 10,
    AD17: 10,
    AE17: 10,
    AF17: 10,
  }))
    set("Term 1", cell, v);
  wb.Sheets["FINAL GRADES"].J17 = {
    t: "s",
    f: 'IF(H17="","",IF(H17>=75,"PASSED","FAILED"))',
  };
  return wb;
}
function draft() {
  return parseWorkbook(book());
}
describe("XLSX mappings and identifiers", () => {
  it("reads fixed cell mappings and male/female ranges, never headers or totals", () => {
    const d = draft();
    expect(d.learners).toHaveLength(2);
    expect(d.assessments).toHaveLength(5);
    expect(d.learners[0].lrn).toBe("001234567890");
    expect(d.learners[1].lrn).toBeNull();
    expect(d.config.applicable_terms).toEqual([1, 2, 3]);
    expect(d.config.weights).toEqual({ ww: 20, pt: 50, ex: 30 });
    expect(d.assessments.every((a) => a.source.cell.endsWith("14"))).toBe(true);
  });
  it("preserves numeric LRNs with zero number format", () => {
    const w = book();
    w.Sheets["INPUT DATA"].N11 = { t: "n", v: 1234567890, z: "000000000000" };
    expect(parseWorkbook(w).learners[0].lrn).toBe("001234567890");
  });
  it("preserves blank versus entered zero and demands missing-LRN consent", () => {
    const d = draft();
    expect(d.scores.find((s) => s.source.cell === "D17")?.value).toBe(0);
    expect(d.scores.find((s) => s.source.cell === "D68")?.value).toBeNull();
    expect(validateDraft(d, false).join(" ")).toContain("Confirm");
    expect(validateDraft(d, true)).toEqual([]);
  });
  it("rejects duplicates, invalid scores and raw formula inputs", () => {
    const d = draft();
    d.learners[1].lrn = d.learners[0].lrn;
    d.scores[0].value = 11;
    expect(validateDraft(d, true).join(" ")).toContain("Duplicate");
    expect(validateDraft(d, true).join(" ")).toContain("Invalid score");
    const w = book();
    w.Sheets["Term 1"].D17.f = 'WEBSERVICE("https://example.invalid")';
    expect(
      parseWorkbook(w).issues.some((i) => i.code === "formula-input"),
    ).toBe(true);
  });
  it("marks altered calculation formulas provisional", () => {
    const w = book();
    w.Sheets["Term 1"].AM17 = { t: "n", v: 99, f: "ROUND(AL17,0)" };
    const d = parseWorkbook(w);
    expect(d.config.resolved).toBe(false);
    expect(d.issues.some((i) => i.code === "unsupported-formula")).toBe(true);
  });
  it("flags changed maximum and learner-row references", () => {
    const w = book();
    w.Sheets["Term 1"].O17 = {
      t: "n",
      v: 99,
      f: 'IFERROR(IF(N17="","",ROUND(N17/N$15*O$14,2)),"")',
    };
    w.Sheets["Term 1"].N17 = {
      t: "n",
      v: 0,
      f: 'IF(COUNT(D18:M18)=0,"",SUM(D18:M18))',
    };
    const d = parseWorkbook(w);
    expect(
      d.issues.some(
        (i) => i.source?.cell === "O17" && i.code === "unsupported-formula",
      ),
    ).toBe(true);
    expect(
      d.issues.some(
        (i) => i.source?.cell === "N17" && i.code === "unsupported-formula",
      ),
    ).toBe(true);
  });
  it("flags replaced calculated values and altered final-grade formulas", () => {
    const w = book();
    w.Sheets["Term 1"].AM17 = { t: "n", v: 99 };
    w.Sheets["FINAL GRADES"].H17 = { t: "n", v: 99, f: "SUM(E17:G17)" };
    const d = parseWorkbook(w);
    expect(d.config.resolved).toBe(false);
    expect(
      d.issues.some(
        (i) => i.source?.cell === "AM17" && i.code === "unsupported-formula",
      ),
    ).toBe(true);
    expect(
      d.issues.some(
        (i) =>
          i.source?.cell === "H17" && i.code === "unsupported-final-formula",
      ),
    ).toBe(true);
  });
  it("lets a teacher resolve an LRN-only slot without importing an empty learner", () => {
    const w = book();
    w.Sheets["INPUT DATA"].N12 = { t: "s", v: "001234567891" };
    const d = parseWorkbook(w);
    const row = d.learners.find((l) => l.source.cell === "O12")!;
    expect(row.included).toBe(false);
    expect(buildPayload(d, undefined, "new", true).learners).toHaveLength(2);
    row.name = "Synthetic Reviewed Learner";
    row.included = true;
    expect(validateDraft(d, true)).toEqual([]);
    expect(buildPayload(d, undefined, "new", true).learners).toHaveLength(3);
  });
  it("excludes group labels and permits explicitly confirmed distinct learners with identical names", () => {
    const w = book();
    w.Sheets["INPUT DATA"].O12 = { t: "s", v: "SECTION A" };
    w.Sheets["INPUT DATA"].S11 = { t: "s", v: "Example, Learner One" };
    const d = parseWorkbook(w);
    expect(d.learners.find((l) => l.name === "SECTION A")?.included).toBe(
      false,
    );
    expect(validateDraft(d, true).join(" ")).toContain("Duplicate names");
    d.allow_duplicate_names = true;
    expect(validateDraft(d, true)).toEqual([]);
    expect(buildPayload(d, undefined, "new", true).learners).toHaveLength(2);
  });
  it("maps CSV strings explicitly and preserves leading zero and blank", () => {
    const csv = readCsv(
      "Name,LRN,Score\nSynthetic One,001234567890,0\nSynthetic Two,,\n",
    );
    const d = mapCsv(
      csv.rows,
      {
        name: "Name",
        lrn: "LRN",
        sex: "",
        assessments: [
          {
            column: "Score",
            category: "ww",
            subcomponent: null,
            maximum: 10,
            term: 1,
          },
        ],
      },
      config,
      "sample.csv",
      "hash",
    );
    expect(d.learners[0].lrn).toBe("001234567890");
    expect(d.scores.map((s) => s.value)).toEqual([0, null]);
  });
});
describe("grading semantics", () => {
  const aa = [
    { category: "ww" as const, subcomponent: null, maximum: 138 },
    { category: "pt" as const, subcomponent: null, maximum: 96 },
    { category: "ex" as const, subcomponent: "ST1" as const, maximum: 30 },
    { category: "ex" as const, subcomponent: "ST2" as const, maximum: 30 },
    { category: "ex" as const, subcomponent: "TE" as const, maximum: 60 },
  ];
  it("reproduces staged PS/WS and individual exam subweights", () => {
    const g = calculateTerm(config, aa, [126, 80, 19, 29, 58]);
    expect(g.components.ww.ps).toBe(91.3);
    expect(g.components.ww.ws).toBe(18.26);
    expect(g.components.pt.ps).toBe(83.33);
    expect(g.components.pt.ws).toBe(41.67);
    expect(g.exam).toEqual({ ST1: 19, ST2: 29, TE: 38.67 });
    expect(g.components.ex.ws).toBe(26);
    expect(g.initial).toBe(85.93);
    expect(g.grade).toBe(88);
  });
  it("uses maximum ceiling, including gaps, exact boundary, and overflow", () => {
    const small = [
      { category: "ww" as const, maximum: 100, subcomponent: null },
      { category: "pt" as const, maximum: 100, subcomponent: null },
    ];
    const c = {
      ...config,
      weights: { ww: 50, pt: 50, ex: 0 },
      subweights: { ST1: 0, ST2: 0, TE: 0 },
    };
    const zero = calculateTerm(c, small, [0, 0]);
    expect(zero.grade).toBe(60);
    for (const r of config.ranges) {
      const at = calculateTerm(c, small, [round(r.upper), round(r.upper)]);
      const expected = [...config.ranges]
        .sort((a, b) => a.upper - b.upper)
        .find((x) => x.upper >= at.initial!);
      expect(at.grade).toBe(expected?.grade ?? null);
    }
    expect(calculateTerm(c, small, [100, 100]).grade).toBe(100);
    expect(calculateTerm(c, small, [100.01, 100.01]).grade).toBeNull();
  });
  it("does not convert blanks to zero; partial inputs stay incomplete", () => {
    const g = calculateTerm(config, aa, [null, 80, 19, null, 58]);
    expect(g.components.ww.total).toBeNull();
    expect(g.initial).toBeNull();
    expect(g.incomplete).toBe(true);
    const partial = calculateTerm(config, aa, [126, 80, 19, null, 58]);
    expect(partial.initial).not.toBeNull();
    expect(partial.incomplete).toBe(true);
    expect(
      calculateFinal(
        config,
        new Map([
          [1, partial],
          [2, partial],
          [3, partial],
        ]),
        "001234567890",
      ).remark,
    ).toBeNull();
  });
  it("rounds ties away from zero at each stage", () => {
    expect(round(90.625)).toBe(90.63);
    expect(round(83.33 * 0.5)).toBe(41.67);
    expect(round(-1.005)).toBe(-1.01);
  });
  it("uses applicable term count/units and requires LRN", () => {
    const g = (n: number): Grade => ({
      ...calculateTerm(config, aa, [100, 90, 30, 30, 60]),
      grade: n,
      incomplete: false,
      provisional: false,
    });
    const terms = new Map([
      [1, g(80)],
      [2, g(90)],
      [3, g(100)],
    ]);
    expect(calculateFinal(config, terms, "001234567890").final).toBe(90);
    expect(
      calculateFinal(
        { ...config, applicable_terms: [2], units_per_year: 2 },
        terms,
        "001234567890",
      ).final,
    ).toBe(90);
    expect(
      calculateFinal(
        { ...config, applicable_terms: [2, 3], units_per_year: 4 },
        terms,
        "001234567890",
      ).final,
    ).toBe(95);
    expect(calculateFinal(config, terms, null).final).toBeNull();
    expect(validateConfig({ ...config, units_per_year: 4 })).not.toEqual([]);
  });
});
describe("import plans", () => {
  it("filters excluded learners and maintains idempotent payload inputs", () => {
    const d = draft();
    d.learners[1].included = false;
    const p = buildPayload(d, undefined, "new", true);
    expect(p.learners).toHaveLength(1);
    expect(p.scores.every((s) => s.learner_key === p.learners[0].key)).toBe(
      true,
    );
    expect(importChanges(d, undefined, "new", true).changes).toHaveLength(5);
    expect(JSON.stringify(p)).toBe(
      JSON.stringify(buildPayload(d, undefined, "new", true)),
    );
  });
});
const referencePath =
  process.env.REFERENCE_WORKBOOK || "C:/Users/PC/Downloads/SALAZAR.xlsx";
describe.skipIf(!existsSync(referencePath))(
  "actual SALAZAR reference (no learner logging)",
  () => {
    it("extracts the inspected source configuration and matches available cached Term 1 calculations", async () => {
      const buffer = await readFile(referencePath);
      const d = parseWorkbook(
        XLSX.read(buffer, { type: "buffer", cellFormula: true, cellNF: true }),
        "SALAZAR.xlsx",
      );
      expect(d.learners).toHaveLength(25);
      expect(d.learners.filter((l) => l.lrn === null)).toHaveLength(25);
      expect(d.assessments).toHaveLength(11);
      expect(d.assessments.every((a) => a.term === 1)).toBe(true);
      expect(
        d.issues
          .filter((i) => i.code.startsWith("unsupported"))
          .map((i) => ({ code: i.code, source: i.source })),
      ).toEqual([]);
      expect(d.config.resolved).toBe(true);
      expect(d.config.weights).toEqual({ ww: 20, pt: 50, ex: 30 });
      expect(d.config.subweights).toEqual({ ST1: 30, ST2: 30, TE: 40 });
      expect(d.config.applicable_terms).toEqual([1, 2, 3]);
      expect(validateDraft(d, true)).toEqual([]);
      const mismatch = compareEvidence(d).filter((m) => m.term === 1);
      expect(
        mismatch.map((m) => ({
          cell: m.source.cell,
          field: m.field,
          cached: m.cached,
          actual: m.recalculated,
        })),
      ).toEqual([]);
    });
  },
);
