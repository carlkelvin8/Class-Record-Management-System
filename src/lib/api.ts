import { fetchAllPages } from "./pagination";
import { supabase } from "./supabase";
import { useQuery } from "@tanstack/react-query";
import type {
  Assessment,
  ClassRow,
  Config,
  Enrollment,
  Score,
  Grade,
} from "./types";
export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw Error(error.message);
  return data as T;
}
async function rows<T>(table: string, classId?: string) {
  return fetchAllPages<T>(async (from, to) => {
    let q = supabase.from(table).select("*");
    if (classId) q = q.eq("class_id", classId);
    // Unique ordering keeps page boundaries stable, including grade views.
    q =
      table === "term_grades"
        ? q.order("enrollment_id").order("number")
        : q.order(table === "final_grades" ? "enrollment_id" : "id");
    return await q.range(from, to);
  });
}
export function useClasses() {
  return useQuery({
    queryKey: ["classes"],
    queryFn: () => rows<ClassRow>("classes"),
  });
}
export interface Bundle {
  info: ClassRow;
  config: Config;
  learners: Enrollment[];
  assessments: Assessment[];
  scores: Score[];
  terms: { id: string; number: number; units: number }[];
  categories: { id: string; code: string; label: string }[];
  termGrades: { enrollment_id: string; number: number; result: Grade }[];
  finalGrades: {
    enrollment_id: string;
    result: {
      final: number | null;
      incomplete: boolean;
      provisional: boolean;
      descriptor: string | null;
      remark: string | null;
    };
  }[];
}
export async function getBundle(id: string): Promise<Bundle> {
  const results = await Promise.all([
    supabase.from("classes").select("*").eq("id", id).single(),
    rpc<Config>("config_json", { p_class: id }),
    rows<Enrollment>("class_enrollments", id),
    rows<Assessment>("assessments", id),
    rows<Score>("scores", id),
    rows<Bundle["terms"][number]>("terms", id),
    rows<Bundle["categories"][number]>("assessment_categories", id),
    rows<Bundle["termGrades"][number]>("term_grades", id),
    rows<Bundle["finalGrades"][number]>("final_grades", id),
  ]);
  if (results[0].error) throw Error(results[0].error.message);
  return {
    info: results[0].data,
    config: results[1],
    learners: results[2],
    assessments: results[3],
    scores: results[4],
    terms: results[5],
    categories: results[6],
    termGrades: results[7],
    finalGrades: results[8],
  };
}
export function useBundle(id: string | undefined) {
  return useQuery({
    queryKey: ["class", id],
    queryFn: () => getBundle(id!),
    enabled: !!id,
  });
}
export interface RecordOptions {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  sort: string;
  desc: boolean;
  term: number;
  final?: boolean;
}
export interface RecordPage extends Bundle {
  total: number;
  page: number;
  pageSize: number;
}
export function getRecordPage(id: string, o: RecordOptions) {
  return rpc<RecordPage>("record_page", {
    p_class: id,
    p_page: o.page,
    p_size: o.pageSize,
    p_search: o.search,
    p_status: o.status,
    p_sort: o.sort,
    p_desc: o.desc,
    p_term: o.term,
    p_final: !!o.final,
  });
}
export function useRecordPage(id: string | undefined, options: RecordOptions) {
  return useQuery({
    queryKey: ["class", id, "page", options],
    queryFn: () => getRecordPage(id!, options),
    enabled: !!id,
    placeholderData: (previous, query) =>
      query?.queryKey[1] === id ? previous : undefined,
  });
}
// Exports deliberately retrieve every matching page, never just the visible rows.
export async function getRecordExport(id: string, options: RecordOptions) {
  const first = await getRecordPage(id, { ...options, page: 0, pageSize: 100 });
  for (let page = 1; page * 100 < first.total; page++) {
    const next = await getRecordPage(id, { ...options, page, pageSize: 100 });
    first.learners.push(...next.learners);
    first.scores.push(...next.scores);
    first.termGrades.push(...next.termGrades);
    first.finalGrades.push(...next.finalGrades);
  }
  return first;
}
export function exportCsv(
  filename: string,
  headers: string[],
  data: unknown[][],
) {
  const safe = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return (
      '"' + (/^[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"'
    );
  };
  const blob = new Blob(
    [
      "\uFEFF" +
        [headers, ...data].map((r) => r.map(safe).join(",")).join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(u);
}
