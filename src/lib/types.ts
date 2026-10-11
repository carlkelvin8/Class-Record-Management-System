export type Category = "ww" | "pt" | "ex";
export type Sub = "ST1" | "ST2" | "TE";
export interface Source {
  sheet: string;
  cell: string;
  formula?: string;
  cached?: unknown;
}
export interface Range {
  lower: number;
  upper: number;
  grade: number;
  source?: Source;
}
export interface Descriptor {
  grade: number;
  label: string;
  source?: Source;
}
export interface Config {
  rules_version: "salazar-v1";
  resolved: boolean;
  weights: Record<Category, number>;
  subweights: Record<Sub, number>;
  applicable_terms: number[];
  units_per_term: number;
  units_per_year: number;
  passing_threshold: number;
  ranges: Range[];
  descriptors: Descriptor[];
  source?: Source;
  confirmation?: string;
}
export interface ClassInfo {
  school: string;
  school_id: string;
  region: string;
  division: string;
  teacher: string;
  grade_level: string;
  section: string;
  school_year: string;
  subject: string;
  cluster: string;
  subject_category: string;
}
export interface Learner {
  key: string;
  name: string;
  lrn: string | null;
  sex: string;
  source: Source;
  included: boolean;
  enrollment_id?: string;
}
export interface AssessmentInput {
  key: string;
  term: number;
  category: Category;
  subcomponent: Sub | null;
  name: string;
  maximum: number;
  source: Source;
}
export interface ScoreInput {
  learner_key: string;
  assessment_key: string;
  value: number | null;
  source: Source;
}
export interface Issue {
  code: string;
  severity: "error" | "warning";
  message: string;
  source?: Source;
}
export interface Evidence {
  learner_key: string;
  term: number;
  field: string;
  cached: unknown;
  source: Source;
}
export interface ImportDraft {
  allow_duplicate_names?: boolean;
  info: ClassInfo;
  config: Config;
  learners: Learner[];
  assessments: AssessmentInput[];
  scores: ScoreInput[];
  issues: Issue[];
  evidence: Evidence[];
  provenance: { kind: string; key: string; source: Source }[];
  filename: string;
  fingerprint: string;
}
export interface Grade {
  components: Record<
    Category,
    {
      total: number | null;
      maximum: number;
      ps: number | null;
      ws: number | null;
    }
  >;
  exam: Record<Sub, number | null>;
  initial: number | null;
  grade: number | null;
  incomplete: boolean;
  provisional: boolean;
}
export interface Enrollment {
  id: string;
  class_id: string;
  name: string;
  lrn: string | null;
  sex: string;
  source_key: string | null;
}
export interface Assessment {
  id: string;
  class_id: string;
  term_id: string;
  category_id: string;
  source_key: string;
  name: string;
  maximum: number;
  subcomponent: Sub | null;
  ordinal: number;
}
export interface Score {
  id: string;
  class_id: string;
  enrollment_id: string;
  assessment_id: string;
  value: number | null;
  version: number;
}
export interface ClassRow extends ClassInfo {
  id: string;
  owner_id: string;
  revision: number;
  created_at: string;
  archived: boolean;
}
