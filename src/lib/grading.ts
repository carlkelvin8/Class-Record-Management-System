import Decimal from "decimal.js";
import type { AssessmentInput, Category, Config, Grade, Sub } from "./types";
const D = (v: number | string) => new Decimal(v);
export const round = (n: number, places = 2) =>
  D(n).toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toNumber();
const sum = (ns: number[]) => ns.reduce((a, b) => a.plus(b), D(0));
export function calculateTerm(
  config: Config,
  assessments: Pick<AssessmentInput, "category" | "subcomponent" | "maximum">[],
  values: (number | null)[],
): Grade {
  const components = {} as Grade["components"];
  const exam = { ST1: null, ST2: null, TE: null } as Grade["exam"];
  let incomplete = false;
  for (const category of ["ww", "pt", "ex"] as Category[]) {
    const ix = assessments
      .map((a, i) => (a.category === category ? i : -1))
      .filter((i) => i >= 0);
    const active = ix.filter((i) => assessments[i].maximum > 0);
    const entered = active.filter((i) => values[i] !== null);
    if (
      category !== "ex" &&
      config.weights[category] > 0 &&
      (active.length === 0 || active.some((i) => values[i] === null))
    )
      incomplete = true;
    const maximum = sum(active.map((i) => assessments[i].maximum)).toNumber();
    const total = entered.length
      ? sum(entered.map((i) => values[i]!)).toNumber()
      : null;
    let ps: number | null = null,
      ws: number | null = null;
    if (category === "ex") {
      for (const sub of ["ST1", "ST2", "TE"] as Sub[]) {
        const i = active.find((i) => assessments[i].subcomponent === sub);
        if (
          config.weights.ex > 0 &&
          config.subweights[sub] > 0 &&
          (i === undefined || values[i] === null)
        )
          incomplete = true;
        if (i !== undefined && values[i] !== null)
          exam[sub] = D(values[i]!)
            .div(assessments[i].maximum)
            .mul(config.subweights[sub])
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toNumber();
      }
      const parts = Object.values(exam).filter((v): v is number => v !== null),
        den = sum(Object.values(config.subweights));
      if (config.weights.ex > 0 && parts.length && den.gt(0))
        ps = sum(parts).div(den).mul(100).toNumber();
    } else if (total !== null && maximum > 0)
      ps = D(total)
        .div(maximum)
        .mul(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toNumber();
    if (ps !== null)
      ws = D(ps)
        .mul(config.weights[category])
        .div(100)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toNumber();
    if (config.weights[category] === 0) ws = 0;
    components[category] = { total, maximum, ps, ws };
  }
  const ready =
    components.ww.ws !== null &&
    components.pt.ws !== null &&
    components.ex.ws !== null;
  const initial = ready
    ? sum([
        components.ww.ws!,
        components.pt.ws!,
        components.ex.ws ?? 0,
      ]).toNumber()
    : null;
  const lookup =
    initial === null
      ? undefined
      : [...config.ranges]
          .sort((a, b) => a.upper - b.upper)
          .find((r) => D(r.upper).gte(initial));
  return {
    components,
    exam,
    initial,
    grade: config.resolved ? (lookup?.grade ?? null) : null,
    incomplete: incomplete || initial === null,
    provisional: !config.resolved || (initial !== null && !lookup),
  };
}
export function calculateFinal(
  config: Config,
  terms: Map<number, Grade>,
  lrn: string | null,
) {
  const selected = config.applicable_terms.map((t) => terms.get(t));
  const incomplete = selected.some(
    (t) => !t || t.grade === null || t.incomplete,
  );
  const provisional =
    !config.resolved || !lrn || selected.some((t) => t?.provisional);
  const final =
    !provisional &&
    selected.every((t) => t?.grade !== null && t?.grade !== undefined) &&
    config.units_per_year > 0
      ? sum(selected.map((t) => t!.grade!))
          .mul(config.units_per_term)
          .div(config.units_per_year)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toNumber()
      : null;
  return {
    final,
    incomplete,
    provisional,
    descriptor:
      config.descriptors.find((d) => d.grade === final)?.label ?? null,
    remark:
      final === null || incomplete || provisional
        ? null
        : final >= config.passing_threshold
          ? "PASSED"
          : "FAILED",
  };
}
export function validateConfig(c: Config): string[] {
  const errors: string[] = [];
  if (c.rules_version !== "salazar-v1")
    errors.push("Unsupported grading rules.");
  if (
    Object.values(c.weights).some(
      (n) => !Number.isFinite(n) || n < 0 || n > 100,
    ) ||
    sum(Object.values(c.weights)).toNumber() !== 100
  )
    errors.push("Component weights must total 100%.");
  if (
    Object.values(c.subweights).some(
      (n) => !Number.isFinite(n) || n < 0 || n > 100,
    ) ||
    (c.weights.ex > 0 && sum(Object.values(c.subweights)).toNumber() !== 100)
  )
    errors.push("Examination subweights must total 100%.");
  if (
    !c.applicable_terms.length ||
    new Set(c.applicable_terms).size !== c.applicable_terms.length ||
    c.applicable_terms.some((t) => ![1, 2, 3].includes(t))
  )
    errors.push("Select unique applicable terms.");
  if (
    !(c.units_per_term > 0) ||
    !(c.units_per_year > 0) ||
    !Number.isFinite(c.units_per_term) ||
    c.units_per_year !== c.units_per_term * c.applicable_terms.length
  )
    errors.push("Annual units must equal term units × applicable term count.");
  if (
    !Number.isFinite(c.passing_threshold) ||
    c.passing_threshold < 0 ||
    c.passing_threshold > 100
  )
    errors.push("Invalid passing threshold.");
  if (
    c.ranges.length !== 41 ||
    new Set(c.ranges.map((r) => r.upper)).size !== 41 ||
    c.ranges.some(
      (r) =>
        !Number.isFinite(r.upper) ||
        !Number.isFinite(r.lower) ||
        r.lower < 0 ||
        r.upper < r.lower ||
        r.upper > 100 ||
        r.grade < 60 ||
        r.grade > 100 ||
        !Number.isInteger(r.grade),
    )
  )
    errors.push("Review all 41 workbook transmutation rows.");
  if (
    c.descriptors.length !== 41 ||
    new Set(c.descriptors.map((d) => d.grade)).size !== 41 ||
    c.descriptors.some((d) => !d.label.trim() || d.grade < 60 || d.grade > 100)
  )
    errors.push("Review the exact grade descriptors.");
  return errors;
}
