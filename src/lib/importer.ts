import * as XLSX from "xlsx";
import Papa from "papaparse";
import signatures from "./formula-signatures.json";
import finalSignatures from "./final-formula-signatures.json";
import { calculateTerm, calculateFinal, validateConfig } from "./grading";
import type {
  ImportDraft,
  Config,
  Source,
  Category,
  Sub,
  Grade,
} from "./types";
import { emptyInfo } from "./class-info";
export { emptyInfo } from "./class-info";
export async function fingerprint(buffer: ArrayBuffer) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
const sig = (s: string, row: number) =>
  s
    .replace(/\$?[A-Z]{1,3}(\$?)(\d+)/g, (m, fixed, r) =>
      !fixed && Number(r) === row ? m.replace(/\d+$/, "#") : m,
    )
    .replace(/\s+/g, "")
    .toUpperCase()
    .replaceAll("_XLFN.", "");
export const rawColumns = [
  ...Array.from({ length: 10 }, (_, i) => ({
    column: XLSX.utils.encode_col(i + 3),
    category: "ww" as Category,
    subcomponent: null,
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    column: XLSX.utils.encode_col(i + 16),
    category: "pt" as Category,
    subcomponent: null,
  })),
  ...(["ST1", "ST2", "TE"] as Sub[]).map((subcomponent, i) => ({
    column: XLSX.utils.encode_col(i + 29),
    category: "ex" as Category,
    subcomponent,
  })),
];
export function parseWorkbook(
  wb: XLSX.WorkBook,
  filename = "Workbook.xlsx",
  hash = "",
): ImportDraft {
  const required = [
    "INPUT DATA",
    "Term 1",
    "Term 2",
    "Term 3",
    "FINAL GRADES",
    "HELPER",
  ];
  if (required.some((s) => !wb.Sheets[s]))
    throw Error(
      "Unrecognized workbook. Required sheets: " + required.join(", "),
    );
  const draft: ImportDraft = {
    info: emptyInfo(),
    config: {
      rules_version: "salazar-v1",
      resolved: true,
      weights: { ww: 0, pt: 0, ex: 0 },
      subweights: { ST1: 0, ST2: 0, TE: 0 },
      applicable_terms: [],
      units_per_term: 0,
      units_per_year: 0,
      passing_threshold: 75,
      ranges: [],
      descriptors: [],
    },
    learners: [],
    assessments: [],
    scores: [],
    issues: [],
    evidence: [],
    provenance: [],
    filename,
    fingerprint: hash,
  };
  const source = (sheet: string, cell: string): Source => ({
    sheet,
    cell,
    ...(wb.Sheets[sheet][cell]?.f ? { formula: wb.Sheets[sheet][cell].f } : {}),
  });
  const issue = (
    code: string,
    message: string,
    sheet: string,
    cell: string,
    severity: "error" | "warning" = "error",
  ) =>
    draft.issues.push({ code, message, severity, source: source(sheet, cell) });
  const raw = (sheet: string, cell: string, kind = "input") => {
    const c = wb.Sheets[sheet][cell];
    draft.provenance.push({
      kind,
      key: sheet + "!" + cell,
      source: source(sheet, cell),
    });
    if (c?.f)
      issue(
        "formula-input",
        "Formula in a source input. Replace with a reviewed raw value.",
        sheet,
        cell,
      );
    return c?.v;
  };
  const text = (sheet: string, cell: string) => {
    const c = wb.Sheets[sheet][cell];
    const v = raw(sheet, cell);
    if (v == null || v === "") return "";
    if (typeof v === "number" && c?.z && /^0+$/.test(c.z))
      return XLSX.utils.format_cell(c);
    return String(v).trim();
  };
  const number = (sheet: string, cell: string, blank = 0) => {
    const v = raw(sheet, cell, "configuration");
    if (v == null || v === "") return blank;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      issue("invalid-number", "Expected a finite number.", sheet, cell);
      return blank;
    }
    return n;
  };
  const inputs: Record<string, string> = {
    school: "F14",
    school_id: "F13",
    region: "F10",
    division: "F11",
    teacher: "F22",
    grade_level: "F24",
    section: "F25",
    subject: "F30",
    cluster: "F29",
    subject_category: "F28",
  };
  for (const [field, cell] of Object.entries(inputs))
    (draft.info as unknown as Record<string, string>)[field] = text(
      "INPUT DATA",
      cell,
    );
  const year = text("INPUT DATA", "F16");
  draft.info.school_year =
    year && Number.isFinite(Number(year))
      ? year + "–" + (Number(year) + 1)
      : year;
  const other =
    draft.info.cluster === "OTHER ELECTIVE / SPECIAL CURRICULAR PROGRAM";
  if (other) draft.info.subject = text("INPUT DATA", "F39");
  const candidates = Array.from({ length: 155 }, (_, i) => i + 7).filter(
    (r) =>
      String(wb.Sheets.HELPER["L" + r]?.v ?? "").trim() ===
        draft.info.subject &&
      String(wb.Sheets.HELPER["K" + r]?.v ?? "").trim() ===
        draft.info.cluster &&
      String(wb.Sheets.HELPER["J" + r]?.v ?? "").trim() ===
        draft.info.subject_category &&
      String(wb.Sheets.HELPER["N" + r]?.v ?? "")
        .split(/[^0-9]+/)
        .includes(draft.info.grade_level),
  );
  let count = 0,
    start = 0;
  if (!other && candidates.length === 1) {
    const r = candidates[0],
      gr12 = draft.info.grade_level === "12";
    draft.config.source = source("HELPER", "W" + r + ":AC" + r);
    draft.config.weights = {
      ww: number("HELPER", "W" + r),
      pt: number("HELPER", "X" + r),
      ex: number("HELPER", "Y" + r),
    };
    draft.config.subweights = {
      ST1: number("HELPER", "AA" + r),
      ST2: number("HELPER", "AB" + r),
      TE: number("HELPER", "AC" + r),
    };
    count = number("HELPER", (gr12 ? "T" : "P") + r);
    draft.config.units_per_term = number("HELPER", (gr12 ? "U" : "Q") + r);
    draft.config.units_per_year = draft.config.units_per_term * count;
    const block = text("INPUT DATA", "H33");
    start = ["FIRST TERM", "SECOND TERM", "THIRD TERM"].indexOf(block) + 1;
    if (count === 3) start = 1;
  } else if (other) {
    draft.config.weights = {
      ww: number("INPUT DATA", "F43"),
      pt: number("INPUT DATA", "F44"),
      ex: number("INPUT DATA", "F45"),
    };
    draft.config.subweights = {
      ST1: number("INPUT DATA", "F46"),
      ST2: number("INPUT DATA", "F47"),
      TE: number("INPUT DATA", "F48"),
    };
    count = number("INPUT DATA", "F51");
    draft.config.units_per_term = number("INPUT DATA", "F52");
    draft.config.units_per_year = count * draft.config.units_per_term;
    start =
      ["FIRST TERM", "SECOND TERM", "THIRD TERM"].indexOf(
        text("INPUT DATA", "H51"),
      ) + 1;
    if (count === 3) start = 1;
    draft.config.resolved = false;
    issue(
      "custom-units",
      "Custom elective units conflict with the template helper lookup. Review and confirm grading configuration.",
      "INPUT DATA",
      "F52",
      "warning",
    );
  } else {
    draft.config.resolved = false;
    issue(
      "ambiguous-config",
      "Subject/cluster/grade does not resolve to exactly one helper row.",
      "INPUT DATA",
      "F30",
      "warning",
    );
  }
  draft.config.applicable_terms = Array.from(
    { length: Math.max(0, Math.min(count, 3)) },
    (_, i) => start + i,
  );
  for (let r = 7; r <= 47; r++) {
    draft.config.ranges.push({
      lower: number("HELPER", "B" + r),
      upper: number("HELPER", "C" + r),
      grade: number("HELPER", "D" + r),
      source: source("HELPER", "B" + r + ":D" + r),
    });
    draft.config.descriptors.push({
      grade: number("HELPER", "AG" + r),
      label: text("HELPER", "AH" + r),
      source: source("HELPER", "AG" + r + ":AH" + r),
    });
  }
  const remark = wb.Sheets["FINAL GRADES"].J17?.f ?? "";
  if (!/H17>=75/.test(remark)) {
    draft.config.resolved = false;
    issue(
      "unsupported-remark",
      "Passing threshold formula was modified; confirm configuration.",
      "FINAL GRADES",
      "J17",
      "warning",
    );
  }
  for (const sex of ["male", "female"])
    for (let r = 11; r <= 60; r++) {
      const nc = sex === "male" ? "O" : "S",
        lc = sex === "male" ? "N" : "R";
      const name = text("INPUT DATA", nc + r),
        lrn = text("INPUT DATA", lc + r) || null;
      if (!name && !lrn) continue;
      if (!name && lrn)
        issue(
          "orphan-lrn",
          "LRN without a learner name. Add a reviewed name and include this row, or keep it excluded.",
          "INPUT DATA",
          lc + r,
          "warning",
        );
      const key = "INPUT DATA!" + nc + r;
      draft.learners.push({
        key,
        name,
        lrn,
        sex,
        included:
          Boolean(name) &&
          !/^(?:(?:MALE|FEMALE)(?:\s+LEARNERS)?(?:\s*\(.*\))?|SECTION(?:\s+.*)?|GRADE\s+\d+(?:\s+.*)?|G\d+[-\s].*)$/i.test(
            name,
          ),
        source: source("INPUT DATA", nc + r),
      });
      if (!lrn)
        issue(
          "missing-lrn",
          "Learner has no LRN. Confirm application identifier before import.",
          "INPUT DATA",
          lc + r,
          "warning",
        );
      if (
        /^(?:(?:MALE|FEMALE)(?:\s+LEARNERS)?(?:\s*\(.*\))?|SECTION(?:\s+.*)?|GRADE\s+\d+(?:\s+.*)?|G\d+[-\s].*)$/i.test(
          name,
        )
      )
        issue(
          "group-label",
          "Possible group label. Exclude this row or explicitly review it.",
          "INPUT DATA",
          nc + r,
          "warning",
        );
    }
  for (const term of [1, 2, 3]) {
    const sheet = "Term " + term;
    for (const { column, category, subcomponent } of rawColumns) {
      const max = number(sheet, column + "14");
      const populated = draft.learners.some((l) => {
        const r =
          Number(l.source.cell.match(/\d+/)![0]) + (l.sex === "male" ? 6 : 57);
        const v = wb.Sheets[sheet][column + r]?.v;
        return v !== undefined && v !== "";
      });
      if (!max && !populated) continue;
      if (!draft.config.applicable_terms.includes(term)) {
        issue(
          "inactive-term",
          "Scores or maxima exist in a nonapplicable term; resolve term selection.",
          sheet,
          column + "14",
        );
        continue;
      }
      if (!(max > 0))
        issue(
          "missing-maximum",
          "Scores require a positive maximum.",
          sheet,
          column + "14",
        );
      const key = sheet + "!" + column;
      draft.assessments.push({
        key,
        term,
        category,
        subcomponent,
        name:
          subcomponent ??
          (category === "ww" ? "Written " : "Performance ") +
            wb.Sheets[sheet][column + "13"]?.v,
        maximum: max,
        source: source(sheet, column + "14"),
      });
      for (const l of draft.learners) {
        const row =
            Number(l.source.cell.match(/\d+/)![0]) +
            (l.sex === "male" ? 6 : 57),
          addr = column + row,
          v = raw(sheet, addr, "score");
        const value =
          v === undefined || v === null || v === "" ? null : Number(v);
        draft.scores.push({
          learner_key: l.key,
          assessment_key: key,
          value,
          source: source(sheet, addr),
        });
        if (
          value !== null &&
          (!Number.isFinite(value) || value < 0 || value > max)
        )
          issue(
            "invalid-score",
            "Score is nonnumeric, negative or above the maximum.",
            sheet,
            addr,
          );
      }
    }
    for (const l of draft.learners) {
      const row =
        Number(l.source.cell.match(/\d+/)![0]) + (l.sex === "male" ? 6 : 57);
      for (const [column, field] of Object.entries({
        N: "ww.total",
        O: "ww.ps",
        P: "ww.ws",
        AA: "pt.total",
        AB: "pt.ps",
        AC: "pt.ws",
        AG: "exam.ST1",
        AH: "exam.ST2",
        AI: "exam.TE",
        AJ: "ex.ps",
        AK: "ex.ws",
        AL: "initial",
        AM: "grade",
      })) {
        const addr = column + row,
          c = wb.Sheets[sheet][addr];
        if (
          draft.config.applicable_terms.includes(term) &&
          (!c?.f ||
            !((signatures as Record<string, string[]>)[column] ?? [])
              .map((v) => v.replaceAll("_XLFN.", ""))
              .includes(sig(c.f, row)))
        ) {
          draft.config.resolved = false;
          issue(
            "unsupported-formula",
            "Altered calculation formula. Affected grades are provisional until configuration is reviewed.",
            sheet,
            addr,
            "warning",
          );
        }
        if (c?.v !== undefined && c.v !== "")
          draft.evidence.push({
            learner_key: l.key,
            term,
            field,
            cached: c.v,
            source: { ...source(sheet, addr), cached: c.v },
          });
      }
    }
  }
  for (const l of draft.learners) {
    const row =
      Number(l.source.cell.match(/\d+/)![0]) + (l.sex === "male" ? 6 : 57);
    for (const col of ["E", "F", "G", "H", "I", "J"]) {
      const addr = col + row,
        c = wb.Sheets["FINAL GRADES"][addr];
      if (
        !c?.f ||
        !((finalSignatures as Record<string, string[]>)[col] ?? [])
          .map((v) => v.replaceAll("_XLFN.", ""))
          .includes(sig(c.f, row))
      ) {
        draft.config.resolved = false;
        issue(
          "unsupported-final-formula",
          "Final-grade formula is missing or modified; review the supported rule and configuration.",
          "FINAL GRADES",
          addr,
          "warning",
        );
      }
    }
    for (const [col, field] of Object.entries({
      H: "final",
      I: "descriptor",
      J: "remark",
    })) {
      const c = wb.Sheets["FINAL GRADES"][col + row];
      if (c?.v !== undefined && c.v !== "")
        draft.evidence.push({
          learner_key: l.key,
          term: 0,
          field,
          cached: c.v,
          source: source("FINAL GRADES", col + row),
        });
    }
  }
  if (wb.Workbook?.Names?.some((n) => /#REF!|\[\d+\]/.test(n.Ref)))
    draft.issues.push({
      code: "external-name",
      severity: "warning",
      message:
        "Broken/external defined names detected. Dropdown references are not executed.",
    });
  return draft;
}
export async function readXlsx(file: File) {
  if (file.size > 15 * 1024 * 1024)
    throw Error("Maximum upload size is 15 MB.");
  const b = await file.arrayBuffer();
  return parseWorkbook(
    XLSX.read(b, {
      type: "array",
      cellFormula: true,
      cellNF: true,
      bookVBA: false,
    }),
    file.name,
    await fingerprint(b),
  );
}
export interface CsvMapping {
  name: string;
  lrn: string;
  sex: string;
  assessments: {
    column: string;
    category: Category;
    subcomponent: Sub | null;
    maximum: number;
    term: number;
  }[];
}
export function readCsv(text: string) {
  const p = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  if (p.errors.length) throw Error(p.errors[0].message);
  return { headers: p.meta.fields ?? [], rows: p.data };
}
export function mapCsv(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  config: Config,
  filename: string,
  hash: string,
): ImportDraft {
  const d: ImportDraft = {
    info: emptyInfo(),
    config,
    learners: [],
    assessments: [],
    scores: [],
    issues: [
      {
        code: "csv-limit",
        severity: "warning",
        message:
          "CSV preserves one flat table only. Sheets, formulas and workbook grading configuration cannot be recovered; review the selected configuration.",
      },
    ],
    evidence: [],
    provenance: [],
    filename,
    fingerprint: hash,
  };
  mapping.assessments.forEach((a, i) =>
    d.assessments.push({
      key: "csv-" + i,
      term: a.term,
      category: a.category,
      subcomponent: a.subcomponent,
      name: a.column,
      maximum: a.maximum,
      source: { sheet: "CSV", cell: a.column + "1" },
    }),
  );
  rows.forEach((r, i) => {
    const name = r[mapping.name]?.trim();
    if (!name) return;
    const key = "CSV!" + (i + 2),
      source = { sheet: "CSV", cell: mapping.name + ":" + (i + 2) };
    d.learners.push({
      key,
      name,
      lrn: r[mapping.lrn]?.trim() || null,
      sex: r[mapping.sex]?.trim() || "unspecified",
      included:
        !/^(?:(?:MALE|FEMALE)(?:\s+LEARNERS)?(?:\s*\(.*\))?|SECTION(?:\s+.*)?|GRADE\s+\d+(?:\s+.*)?|G\d+[-\s].*)$/i.test(
          name,
        ),
      source,
    });
    mapping.assessments.forEach((a, j) => {
      const v = r[a.column]?.trim();
      d.scores.push({
        learner_key: key,
        assessment_key: "csv-" + j,
        value: v == null || v === "" ? null : Number(v),
        source: { sheet: "CSV", cell: a.column + ":" + (i + 2) },
      });
    });
  });
  return d;
}
export function validateDraft(d: ImportDraft, allowMissing: boolean) {
  const errors = validateConfig(d.config);
  const ls = d.learners.filter((l) => l.included);
  if (!ls.length) errors.push("Include at least one learner.");
  const seen = new Set<string>();
  for (const l of ls) {
    if (!l.name.trim()) errors.push("Learner name is required.");
    if (l.lrn) {
      if (!/^\d{12}$/.test(l.lrn))
        errors.push("LRNs must be 12 digits; keep leading zeros.");
      if (seen.has(l.lrn)) errors.push("Duplicate LRN " + l.lrn);
      seen.add(l.lrn);
    } else if (!allowMissing)
      errors.push("Confirm identifiers for learners without LRNs.");
  }
  if (
    new Set(ls.map((l) => l.name.trim().toLocaleLowerCase())).size !==
      ls.length &&
    !d.allow_duplicate_names
  )
    errors.push(
      "Duplicate names require explicit confirmation that they identify distinct learners, or exclusion of duplicate rows.",
    );
  for (const a of d.assessments) {
    if (!(a.maximum > 0) || !Number.isFinite(a.maximum))
      errors.push("Review maximum for " + a.key);
    if (!d.config.applicable_terms.includes(a.term))
      errors.push("Assessment term is not applicable: " + a.key);
  }
  for (const s of d.scores.filter((s) =>
    ls.some((l) => l.key === s.learner_key),
  )) {
    const a = d.assessments.find((a) => a.key === s.assessment_key);
    if (
      s.value !== null &&
      (!Number.isFinite(s.value) || s.value < 0 || s.value > (a?.maximum ?? 0))
    )
      errors.push("Invalid score at " + s.source.sheet + "!" + s.source.cell);
  }
  errors.push(
    ...d.issues
      .filter(
        (i) =>
          i.severity === "error" &&
          ["formula-input", "unsupported-formula", "orphan-lrn"].includes(
            i.code,
          ),
      )
      .map((i) => i.message),
  );
  return [...new Set(errors)];
}
export function compareEvidence(d: ImportDraft) {
  const cache = new Map<string, Grade>();
  for (const l of d.learners)
    for (const t of d.config.applicable_terms) {
      const aa = d.assessments.filter((a) => a.term === t);
      cache.set(
        l.key + ":" + t,
        calculateTerm(
          d.config,
          aa,
          aa.map(
            (a) =>
              d.scores.find(
                (s) => s.learner_key === l.key && s.assessment_key === a.key,
              )?.value ?? null,
          ),
        ),
      );
    }
  return d.evidence.flatMap((e) => {
    const l = d.learners.find((l) => l.key === e.learner_key)!;
    const g = cache.get(e.learner_key + ":" + e.term);
    let value: unknown;
    if (e.term === 0) {
      const final = calculateFinal(
        d.config,
        new Map(
          d.config.applicable_terms.map((t) => [
            t,
            cache.get(l.key + ":" + t)!,
          ]),
        ),
        l.lrn,
      );
      value = (final as unknown as Record<string, unknown>)[e.field];
    } else if (g) {
      if (e.field.startsWith("exam."))
        value = g.exam[e.field.split(".")[1] as Sub];
      else if (e.field.includes(".")) {
        const [c, f] = e.field.split(".");
        value = (
          g.components[c as Category] as unknown as Record<string, unknown>
        )[f];
      } else value = g[e.field as "initial" | "grade"];
    }
    if (
      typeof value === "number" &&
      typeof e.cached === "number" &&
      Math.abs(value - e.cached) < 0.000001
    )
      return [];
    if (value === e.cached) return [];
    return [{ ...e, recalculated: value ?? null }];
  });
}
