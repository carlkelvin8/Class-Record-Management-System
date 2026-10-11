import type { Bundle } from "./api";
import type { ImportDraft } from "./types";
import { validateDraft } from "./importer";
export type Strategy = "new" | "keep" | "fill" | "replace";
export function importChanges(
  d: ImportDraft,
  target: Bundle | undefined,
  strategy: Strategy,
  allowMissing: boolean,
) {
  const errors = validateDraft(d, allowMissing),
    learners = d.learners.filter((l) => l.included),
    changes: {
      learner: string;
      assessment: string;
      source: string;
      before: number | null;
      after: number | null;
      action: string;
    }[] = [];
  if (target) {
    const ci = Object.fromEntries(
      Object.entries(target.info).filter(
        ([k]) =>
          !["id", "owner_id", "revision", "archived", "created_at"].includes(k),
      ),
    );
    if (
      Object.keys(d.info).some(
        (k) =>
          (ci as Record<string, unknown>)[k] !==
          d.info[k as keyof typeof d.info],
      )
    )
      errors.push(
        "Class metadata conflict. Align reviewed information with the target class.",
      );
    const clean = (c: ImportDraft["config"]) =>
      JSON.stringify({
        rules_version: c.rules_version,
        resolved: c.resolved,
        weights: [c.weights.ww, c.weights.pt, c.weights.ex],
        subweights: [c.subweights.ST1, c.subweights.ST2, c.subweights.TE],
        terms: [...c.applicable_terms].sort(),
        units: [c.units_per_term, c.units_per_year],
        threshold: c.passing_threshold,
        ranges: [...c.ranges]
          .sort((a, b) => b.grade - a.grade)
          .map((r) => [r.lower, r.upper, r.grade]),
        descriptors: [...c.descriptors]
          .sort((a, b) => b.grade - a.grade)
          .map((r) => [r.grade, r.label]),
      });
    if (clean(d.config) !== clean(target.config))
      errors.push(
        "Grading configuration conflict. Review the existing configuration separately or explicitly use it here.",
      );
    const mapped = new Set<string>();
    for (const l of learners) {
      if (l.enrollment_id) {
        const e = target.learners.find((e) => e.id === l.enrollment_id);
        if (!e) errors.push("Invalid enrollment mapping.");
        else if (e.name !== l.name || e.lrn !== l.lrn || e.sex !== l.sex)
          errors.push(
            "Mapped learner details conflict at " +
              l.source.cell +
              ". Edit the existing learner separately or correct the import row.",
          );
        if (mapped.has(l.enrollment_id))
          errors.push("Multiple rows map to one enrollment.");
        mapped.add(l.enrollment_id);
      } else if (l.lrn && target.learners.some((e) => e.lrn === l.lrn))
        errors.push(
          "Map the existing LRN at " + l.source.cell + " explicitly.",
        );
    }
    for (const a of d.assessments) {
      const existing = target.assessments.find((x) => x.source_key === a.key);
      if (existing) {
        const term = target.terms.find((t) => t.id === existing.term_id),
          category = target.categories.find(
            (c) => c.id === existing.category_id,
          );
        if (
          existing.maximum !== a.maximum ||
          term?.number !== a.term ||
          category?.code !== a.category ||
          existing.subcomponent !== a.subcomponent ||
          existing.name !== a.name
        )
          errors.push(
            "Assessment conflict at " +
              a.source.sheet +
              "!" +
              a.source.cell +
              ". Resolve maxima and definitions before reimport.",
          );
      } else if (
        a.subcomponent &&
        target.assessments.some(
          (x) =>
            x.subcomponent === a.subcomponent &&
            target.terms.find((t) => t.id === x.term_id)?.number === a.term,
        )
      )
        errors.push(
          "Examination identity conflict for Term " +
            a.term +
            " " +
            a.subcomponent,
        );
    }
  }
  for (const s of d.scores) {
    const l = learners.find((l) => l.key === s.learner_key);
    if (!l) continue;
    const a = d.assessments.find((a) => a.key === s.assessment_key);
    const ea = target?.assessments.find(
      (a) => a.source_key === s.assessment_key,
    );
    const prior = target?.scores.find(
      (x) => x.enrollment_id === l.enrollment_id && x.assessment_id === ea?.id,
    );
    const action = !prior
      ? "Insert"
      : strategy === "keep"
        ? "Keep"
        : strategy === "fill" && prior.value !== null
          ? "Keep"
          : prior.value === s.value
            ? "Unchanged"
            : "Update";
    changes.push({
      learner: l.name,
      assessment: a?.name ?? s.assessment_key,
      source: s.source.sheet + "!" + s.source.cell,
      before: prior?.value ?? null,
      after: action === "Keep" ? prior!.value : s.value,
      action,
    });
  }
  return {
    errors: [...new Set(errors)],
    changes,
    newLearners: learners.filter((l) => !l.enrollment_id).length,
    mappedLearners: learners.filter((l) => l.enrollment_id).length,
    newAssessments: d.assessments.filter(
      (a) => !target?.assessments.some((e) => e.source_key === a.key),
    ).length,
  };
}
export function buildPayload(
  d: ImportDraft,
  target: Bundle | undefined,
  strategy: Strategy,
  allowMissing: boolean,
) {
  const included = d.learners.filter((l) => l.included);
  return {
    class_id: target?.info.id ?? null,
    expected_revision: target?.info.revision ?? null,
    strategy,
    allow_missing_lrn: allowMissing,
    allow_duplicate_names: Boolean(d.allow_duplicate_names),
    info: d.info,
    config: d.config,
    filename: d.filename,
    fingerprint: d.fingerprint,
    learners: included.map((l) => ({
      key: l.key,
      name: l.name.trim(),
      lrn: l.lrn,
      sex: l.sex,
      enrollment_id: l.enrollment_id ?? null,
    })),
    assessments: d.assessments,
    scores: d.scores.filter((s) =>
      included.some((l) => l.key === s.learner_key),
    ),
    provenance: [
      ...d.provenance,
      ...d.learners.map((l) => ({
        kind: l.included ? "learner" : "excluded-row",
        key: l.key,
        source: l.source,
      })),
      ...d.assessments.map((a) => ({
        kind: "maximum",
        key: a.key,
        source: a.source,
      })),
      ...d.scores.map((s) => ({
        kind: "score",
        key: s.learner_key + ":" + s.assessment_key,
        source: s.source,
      })),
      ...d.evidence.map((e) => ({
        kind: "cached-comparison",
        key: e.learner_key + ":" + e.field,
        source: { ...e.source, cached: e.cached },
      })),
    ],
  };
}
