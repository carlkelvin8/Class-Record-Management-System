import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  FileSpreadsheet,
  Check,
  ArrowRight,
  ShieldCheck,
  BookOpen,
  Users,
  AlertCircle,
} from "lucide-react";
import { useClasses, useBundle, rpc } from "../lib/api";
import { supabase } from "../lib/supabase";
import {
  readXlsx,
  readCsv,
  mapCsv,
  fingerprint,
  compareEvidence,
} from "../lib/importer";
import { buildPayload, importChanges, type Strategy } from "../lib/import-plan";
import reference from "../lib/reference-config.json";
import type { Config, ImportDraft } from "../lib/types";
import { CsvMapper } from "../components/CsvMapper";
import {
  PageTitle,
  Card,
  Button,
  Input,
  ErrorBox,
  ConfigForm,
} from "../components/common";
export function ImportPage() {
  const classes = useClasses(),
    nav = useNavigate(),
    qc = useQueryClient();
  const [d, setD] = useState<ImportDraft | null>(null),
    [file, setFile] = useState<File | null>(null),
    [csv, setCsv] = useState<ReturnType<typeof readCsv> | null>(null),
    [csvHash, setCsvHash] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [target, setTarget] = useState("new"),
    [strategy, setStrategy] = useState<Strategy>("new"),
    [allowMissing, setAllowMissing] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [retain, setRetain] = useState(false),
    [scoreTerm, setScoreTerm] = useState(1),
    [changeFilter, setChangeFilter] = useState("all"),
    [dragging, setDragging] = useState(false);
  const [allowDuplicateFile, setAllowDuplicateFile] = useState(false);
  const duplicates = useQuery({
    queryKey: ["import-duplicates", d?.fingerprint],
    enabled: !!d,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_batches")
        .select("class_id,filename,created_at")
        .eq("fingerprint", d!.fingerprint)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw Error(error.message);
      return data ?? [];
    },
  });
  const existing = useBundle(target === "new" ? undefined : target);
  const [confirmation, setConfirmation] = useState<{
    token: string;
    payload: ReturnType<typeof buildPayload>;
    plan: ReturnType<typeof importChanges>;
  } | null>(null);
  const edit = (next: ImportDraft) => {
    setD(next);
    setReviewed(false);
    setConfirmation(null);
  };
  const upload = async (f: File) => {
    setBusy(true);
    setAllowDuplicateFile(false);
    setError("");
    setD(null);
    setCsv(null);
    setConfirmation(null);
    setAllowMissing(false);
    setReviewed(false);
    setFile(f);
    setTarget("new");
    setStrategy("new");
    setRetain(false);
    setScoreTerm(1);
    try {
      if (f.size > 15 * 1024 * 1024) throw Error("Maximum file size is 15 MB.");
      if (/\.csv$/i.test(f.name)) {
        setCsv(readCsv(await f.text()));
        setCsvHash(await fingerprint(await f.arrayBuffer()));
      } else if (/\.xlsx$/i.test(f.name)) setD(await readXlsx(f));
      else
        throw Error(
          "Upload an XLSX or CSV file. Macro-enabled workbooks are not accepted.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const plan = d
    ? importChanges(d, existing.data, strategy, allowMissing)
    : null;
  const mismatches = d ? compareEvidence(d) : [];
  const included = d?.learners.filter((l) => l.included) ?? [];
  const missingLrn = included.filter((l) => !l.lrn).length;
  const emptyTerms =
    d?.config.applicable_terms.filter(
      (t) => !d.assessments.some((a) => a.term === t),
    ) ?? [];
  const step = confirmation ? 2 : d ? 1 : 0;
  const reset = () => {
    setD(null);
    setCsv(null);
    setConfirmation(null);
    setFile(null);
    setError("");
    setAllowMissing(false);
    setReviewed(false);
    setTarget("new");
    setStrategy("new");
  };

  return (
    <div className="teacher-import">
      <PageTitle
        title="Bring your class record in"
        description="Choose your Excel file. We'll organise the learners and scores for you."
      />
      <nav aria-label="Import steps" className="import-steps">
        {["Choose a file", "Check your class", "Import"].map((s, i) => (
          <div
            key={s}
            aria-current={step === i ? "step" : undefined}
            className={
              "flex items-center gap-2 " +
              ((confirmation ? 2 : d ? 1 : 0) === i
                ? "font-medium text-primary"
                : "text-slate-400")
            }
          >
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full text-xs " +
                ((confirmation ? 2 : d ? 1 : 0) >= i
                  ? "bg-primary text-white"
                  : "bg-slate-200")
              }
            >
              {step > i ? <Check size={13} /> : i + 1}
            </span>
            {s}
            {i < 2 && <ArrowRight size={14} className="ml-3 text-slate-300" />}
          </div>
        ))}
      </nav>
      <ErrorBox error={error || classes.error || existing.error} />
      {!d && !csv && (
        <div className="import-start-grid">
          <Card className="import-upload-card">
            <label
              className={"import-dropzone " + (dragging ? "is-dragging" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files[0];
                if (f && !busy) void upload(f);
              }}
            >
              <span className="import-file-icon">
                <FileSpreadsheet size={32} />
              </span>
              <span className="import-upload-eyebrow">
                START WITH YOUR EXCEL FILE
              </span>
              <h2>
                {busy
                  ? "Reading your class record..."
                  : "Your workbook. Ready for a new home."}
              </h2>
              <p>
                {busy
                  ? "We're finding your class details, learners, and scores."
                  : "Drag your file here, or choose it from your computer."}
              </p>
              <span className="import-browse">
                {busy ? "Please wait..." : "Choose a workbook"}
                <Upload size={15} />
              </span>
              <input
                className="sr-only"
                aria-label="Choose class record file"
                type="file"
                accept=".xlsx,.csv"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <small>Excel (.xlsx) or CSV · Up to 15 MB</small>
            </label>
            <div className="import-local-note">
              <ShieldCheck size={15} />
              <span>You'll review the file before anything is saved.</span>
            </div>
          </Card>
          <Card className="import-help-card">
            <span className="import-upload-eyebrow">THREE SIMPLE STEPS</span>
            <h2>
              From workbook
              <br />
              to class record.
            </h2>
            {[
              [
                "Choose your file",
                "Use your SALAZAR class record template in Excel format.",
              ],
              [
                "Check the details",
                "Confirm the class, learner list, and any items that need your attention.",
              ],
              [
                "Import and continue",
                "Your record is ready. You can still edit learners, assessments, and scores.",
              ],
            ].map(([title, body], i) => (
              <div className="import-help-step" key={title}>
                <span>{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </div>
            ))}
            <details className="import-template-help">
              <summary>Which files can I use?</summary>
              <p>
                Use the SALAZAR Excel layout with INPUT DATA, Term1, Term2,
                Term3, FINAL GRADES, and HELPER sheets. Keep the original sheet
                names. CSV files need a short column-matching step and a
                grading-rule review.
              </p>
            </details>
          </Card>
        </div>
      )}
      {csv && !d && (
        <>
          <Button variant="outline" className="mb-4" onClick={reset}>
            Choose another file
          </Button>
          <CsvMapper
            headers={csv.headers}
            onMapped={(mapping) => {
              setD(
                mapCsv(
                  csv.rows,
                  mapping,
                  { ...(reference as Config), resolved: false },
                  file!.name,
                  csvHash,
                ),
              );
              setCsv(null);
            }}
          />
        </>
      )}
      {d && !confirmation && (
        <>
          <ErrorBox error={duplicates.error} />
          {!!duplicates.data?.length && (
            <Card className="mb-4 border-amber-200 bg-amber-50 p-5">
              <h2 className="font-semibold">
                This workbook has already been imported
              </h2>
              <p className="mt-1 text-sm">
                Choose the existing class below to update its record, or
                explicitly create a separate copy.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[...new Set(duplicates.data.map((b) => b.class_id))].map(
                  (cid) => (
                    <Button
                      key={cid}
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTarget(cid);
                        setStrategy("keep");
                        setAllowDuplicateFile(false);
                        edit({
                          ...d,
                          learners: d.learners.map((l) => ({
                            ...l,
                            enrollment_id: undefined,
                          })),
                        });
                      }}
                    >
                      Update{" "}
                      {classes.data?.find((c) => c.id === cid)?.section ??
                        "existing class"}
                    </Button>
                  ),
                )}
              </div>
              {target === "new" && (
                <label className="mt-4 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={allowDuplicateFile}
                    onChange={(e) => {
                      setAllowDuplicateFile(e.target.checked);
                      setReviewed(false);
                      setConfirmation(null);
                    }}
                  />
                  I want to create another class from this same workbook.
                </label>
              )}
            </Card>
          )}
        </>
      )}
      {d && !confirmation && (
        <div className="space-y-6">
          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-4">
              <FileSpreadsheet className="text-primary" size={30} />
              <div>
                <p className="text-sm font-semibold">{d.filename}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {d.learners.filter((l) => l.included).length} learners ·{" "}
                  {d.assessments.length} assessments · terms{" "}
                  {d.config.applicable_terms.join(", ") || "unresolved"}
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={reset}>
              Choose another file
            </Button>
          </Card>
          <div className="import-found-summary">
            <div>
              <Users size={17} />
              <strong>{included.length}</strong>
              <span>learners found</span>
            </div>
            <div>
              <BookOpen size={17} />
              <strong>{d.assessments.length}</strong>
              <span>assessments found</span>
            </div>
            <div>
              <Check size={17} />
              <strong>{d.config.applicable_terms.length}</strong>
              <span>applicable terms</span>
            </div>
          </div>
          {emptyTerms.length > 0 && (
            <div className="import-notice">
              <AlertCircle size={18} />
              <p>
                <strong>
                  Term {emptyTerms.join(" and ")} has no assessments yet.
                </strong>{" "}
                You can import now and add these later. Those term grades will
                remain incomplete.
              </p>
            </div>
          )}
          <Card className="space-y-5 p-6">
            <div className="import-card-heading">
              <span>01</span>
              <div>
                <h2>Is this the right class?</h2>
                <p>
                  These details came from your workbook. Change anything that
                  needs correcting.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["section", "Class / section"],
                  ["subject", "Subject"],
                  ["grade_level", "Grade level"],
                  ["school_year", "School year"],
                ] as const
              ).map(([key, label]) => (
                <label className="text-xs font-medium text-slate-600" key={key}>
                  {label}
                  <Input
                    className="mt-2"
                    value={d.info[key]}
                    onChange={(e) =>
                      edit({ ...d, info: { ...d.info, [key]: e.target.value } })
                    }
                  />
                </label>
              ))}
            </div>
            <details className="import-details">
              <summary>School and teacher details</summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["school", "School name"],
                    ["school_id", "School ID"],
                    ["region", "Region"],
                    ["division", "Division"],
                    ["teacher", "Teacher name"],
                    ["cluster", "Subject cluster"],
                    ["subject_category", "Subject category"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    className="text-xs font-medium text-slate-600"
                    key={key}
                  >
                    {label}
                    <Input
                      className="mt-2"
                      value={d.info[key]}
                      onChange={(e) =>
                        edit({
                          ...d,
                          info: { ...d.info, [key]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </details>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm">
                Where should this record go?
                <select
                  className="mt-2 block w-full"
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setStrategy(e.target.value === "new" ? "new" : "keep");
                    edit({
                      ...d,
                      learners: d.learners.map((l) => ({
                        ...l,
                        enrollment_id: undefined,
                      })),
                    });
                  }}
                >
                  <option value="new">Create a new class</option>
                  {classes.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      Update: {c.section} · {c.subject}
                    </option>
                  ))}
                </select>
              </label>
              {target !== "new" && (
                <label className="text-sm">
                  What should happen to existing scores?
                  <select
                    className="mt-2 block w-full"
                    value={strategy}
                    onChange={(e) => {
                      setStrategy(e.target.value as Strategy);
                      setReviewed(false);
                    }}
                  >
                    <option value="keep">Keep every existing score</option>
                    <option value="fill">Fill only existing blanks</option>
                    <option value="replace">
                      Use scores from this file (blank cells also clear existing
                      scores)
                    </option>
                  </select>
                </label>
              )}
            </div>
            {existing.data && (
              <div className="space-y-3 rounded-lg bg-amber-50 p-4 text-sm">
                <p>
                  Existing learners stay in the class. In the learner list
                  below, choose which saved learner each row belongs to. Leaving
                  a row as 'Add as a new learner' creates another learner.
                </p>
                <p>
                  Check that the class details, grading rules, and assessment
                  maximum scores agree with the saved record.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const {
                        id,
                        owner_id,
                        revision,
                        archived,
                        created_at,
                        ...info
                      } = existing.data!.info;
                      edit({ ...d, info });
                    }}
                  >
                    Use saved class details
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      edit({ ...d, config: existing.data!.config })
                    }
                  >
                    Use saved grading rules
                  </Button>
                </div>
              </div>
            )}
          </Card>
          <Card className="p-6">
            <div className="import-card-heading">
              <span>02</span>
              <div>
                <h2>Check your learners</h2>
                <p>
                  {included.length} learners selected
                  {missingLrn
                    ? ` · ${missingLrn} without an LRN`
                    : " · All LRNs provided"}
                  .
                </p>
              </div>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Open the list to correct names or LRNs, or untick any row you
              don't want to import.
            </p>
            <details
              className="import-details"
              open={target !== "new" || undefined}
            >
              <summary>
                View and edit learner list ({d.learners.length})
              </summary>
              <div className="max-h-96 overflow-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Include</th>
                      <th>Name</th>
                      <th>LRN</th>
                      <th>Group</th>
                      <th>Source</th>
                      {target !== "new" && <th>Match to a saved learner</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {d.learners.map((l, i) => (
                      <tr
                        key={l.key}
                        className={!l.included ? "opacity-40" : ""}
                      >
                        <td>
                          <input
                            aria-label={"Include " + l.name}
                            type="checkbox"
                            checked={l.included}
                            onChange={(e) =>
                              edit({
                                ...d,
                                learners: d.learners.map((v, j) =>
                                  i === j
                                    ? { ...v, included: e.target.checked }
                                    : v,
                                ),
                              })
                            }
                          />
                        </td>
                        <td>
                          <Input
                            aria-label="Learner name"
                            className="min-w-64"
                            value={l.name}
                            onChange={(e) =>
                              edit({
                                ...d,
                                learners: d.learners.map((v, j) =>
                                  i === j ? { ...v, name: e.target.value } : v,
                                ),
                              })
                            }
                          />
                        </td>
                        <td>
                          <Input
                            aria-label="LRN"
                            className="min-w-40 font-mono"
                            placeholder="No LRN"
                            value={l.lrn ?? ""}
                            onChange={(e) =>
                              edit({
                                ...d,
                                learners: d.learners.map((v, j) =>
                                  i === j
                                    ? { ...v, lrn: e.target.value || null }
                                    : v,
                                ),
                              })
                            }
                          />
                        </td>
                        <td>{l.sex}</td>
                        <td className="whitespace-nowrap text-xs text-slate-400">
                          {l.source.sheet}!{l.source.cell}
                        </td>
                        {target !== "new" && (
                          <td>
                            <select
                              className="max-w-64"
                              value={l.enrollment_id ?? ""}
                              onChange={(e) =>
                                edit({
                                  ...d,
                                  learners: d.learners.map((v, j) =>
                                    i === j
                                      ? {
                                          ...v,
                                          enrollment_id:
                                            e.target.value || undefined,
                                        }
                                      : v,
                                  ),
                                })
                              }
                            >
                              <option value="">Add as a new learner</option>
                              {existing.data?.learners.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name} · {e.lrn ?? e.id.slice(0, 8)}
                                </option>
                              ))}
                            </select>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            {new Set(
              d.learners
                .filter((l) => l.included)
                .map((l) => l.name.trim().toLocaleLowerCase()),
            ).size < d.learners.filter((l) => l.included).length && (
              <label className="mt-5 flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={Boolean(d.allow_duplicate_names)}
                  onChange={(e) =>
                    edit({ ...d, allow_duplicate_names: e.target.checked })
                  }
                />
                <span>
                  I confirm these identical names belong to distinct learners.
                  Keep separate enrollment identifiers and never merge these
                  rows by name.
                </span>
              </label>
            )}
            {missingLrn > 0 && (
              <label className="mt-5 flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                <input
                  type="checkbox"
                  checked={allowMissing}
                  onChange={(e) => {
                    setAllowMissing(e.target.checked);
                    setReviewed(false);
                  }}
                />
                <span>
                  <strong className="block">
                    Import {missingLrn} learners without an LRN for now.
                  </strong>
                  You can add their LRNs later. Their final grades will remain
                  provisional until then.
                </span>
              </label>
            )}
          </Card>
          <Card className="p-6">
            <details className="import-details">
              <summary>
                Check or correct scores ({d.assessments.length} assessments)
              </summary>
              <p className="mb-4 mt-2 text-xs text-slate-500">
                Your scores are already included. Open this only if you need to
                check or change them. Blank scores stay blank.
              </p>
              <div className="mb-4 flex gap-2">
                {[1, 2, 3].map((t) => (
                  <Button
                    key={t}
                    variant={scoreTerm === t ? "default" : "outline"}
                    size="sm"
                    onClick={() => setScoreTerm(t)}
                  >
                    Term {t}
                    {!d.config.applicable_terms.includes(t) ? " (N/A)" : ""}
                  </Button>
                ))}
              </div>
              <div className="max-h-96 overflow-auto">
                <table className="data-table record-table">
                  <thead>
                    <tr>
                      <th className="learner-sticky">Learner</th>
                      {d.assessments
                        .filter((a) => a.term === scoreTerm)
                        .map((a) => (
                          <th key={a.key}>
                            <div>
                              {a.category.toUpperCase()} · {a.name}
                            </div>
                            <Input
                              className="my-2 w-24"
                              aria-label={"Maximum " + a.name}
                              type="number"
                              min="0.01"
                              step="any"
                              value={a.maximum}
                              onChange={(e) =>
                                edit({
                                  ...d,
                                  assessments: d.assessments.map((v) =>
                                    v.key === a.key
                                      ? {
                                          ...v,
                                          maximum: Number(e.target.value),
                                        }
                                      : v,
                                  ),
                                })
                              }
                            />
                            <span className="block text-[9px] font-normal">
                              {a.source.sheet}!{a.source.cell}
                            </span>
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.learners
                      .filter((l) => l.included)
                      .map((l) => (
                        <tr key={l.key}>
                          <td className="learner-sticky text-xs">{l.name}</td>
                          {d.assessments
                            .filter((a) => a.term === scoreTerm)
                            .map((a) => {
                              const s = d.scores.find(
                                (s) =>
                                  s.learner_key === l.key &&
                                  s.assessment_key === a.key,
                              );
                              return (
                                <td key={a.key}>
                                  <Input
                                    className="w-20"
                                    inputMode="decimal"
                                    aria-label={l.name + " " + a.name}
                                    title={
                                      s?.source.sheet + "!" + s?.source.cell
                                    }
                                    value={s?.value ?? ""}
                                    onChange={(e) =>
                                      edit({
                                        ...d,
                                        scores: d.scores.map((v) =>
                                          v === s
                                            ? {
                                                ...v,
                                                value:
                                                  e.target.value.trim() === ""
                                                    ? null
                                                    : Number(e.target.value),
                                              }
                                            : v,
                                        ),
                                      })
                                    }
                                  />
                                </td>
                              );
                            })}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!d.assessments.some((a) => a.term === scoreTerm) && (
                <p className="mt-4 text-sm text-amber-800">
                  No assessments extracted. Applicable term grades will remain
                  incomplete.
                </p>
              )}
            </details>
          </Card>
          <Card className="p-6">
            <div className="import-card-heading">
              <span>03</span>
              <div>
                <h2>Grading rules</h2>
                <p>
                  {d.config.resolved
                    ? "Recognised from your workbook. You can review or adjust them below."
                    : "Please review and confirm the grading rules before continuing."}
                </p>
              </div>
            </div>
            <div className="import-weight-summary">
              <span>
                Written / Oral <b>{d.config.weights.ww}%</b>
              </span>
              <span>
                Performance <b>{d.config.weights.pt}%</b>
              </span>
              <span>
                Exams <b>{d.config.weights.ex}%</b>
              </span>
            </div>
            <details
              className="import-details"
              open={!d.config.resolved || undefined}
            >
              <summary>Review or change grading rules</summary>
              <ConfigForm
                value={d.config}
                onChange={(config) => edit({ ...d, config })}
              />
              <p className="mt-4 text-xs text-slate-400">
                Configuration source:{" "}
                {d.config.source?.sheet ?? "teacher review"}!
                {d.config.source?.cell ?? "manual"}
              </p>
            </details>
          </Card>
          <Card className="p-6">
            <h2 className="mb-3 font-semibold">Ready to continue?</h2>
            <details
              className="import-details"
              open={d.issues.some((i) => i.severity === "error") || undefined}
            >
              <summary>
                Workbook notes and checks (
                {d.issues.filter((i) => i.code !== "missing-lrn").length} notes)
              </summary>
              <div className="max-h-64 space-y-2 overflow-auto">
                {d.issues.map((issue, i) =>
                  issue.code === "missing-lrn" ? null : (
                    <div
                      key={i}
                      className={
                        "rounded-lg p-3 text-xs " +
                        (issue.severity === "error"
                          ? "bg-red-50 text-red-800"
                          : "bg-amber-50 text-amber-900")
                      }
                    >
                      <strong>
                        {issue.source
                          ? issue.source.sheet + "!" + issue.source.cell + " · "
                          : ""}
                      </strong>
                      {issue.message}
                      {issue.code === "formula-input" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-3"
                          onClick={() => {
                            const note = window.prompt(
                              "Describe the source value you replaced and how you verified it:",
                            );
                            if (note?.trim())
                              edit({
                                ...d,
                                issues: d.issues.filter((_, j) => j !== i),
                                provenance: [
                                  ...d.provenance,
                                  {
                                    kind: "formula-input-resolution: " + note,
                                    key:
                                      issue.source!.sheet +
                                      "!" +
                                      issue.source!.cell,
                                    source: issue.source!,
                                  },
                                ],
                              });
                          }}
                        >
                          Record source resolution
                        </Button>
                      )}
                    </div>
                  ),
                )}
              </div>
              <details className="mt-4">
                <summary className="text-sm font-medium">
                  Cached-result mismatches ({mismatches.length})
                </summary>
                <p className="my-3 text-xs text-slate-500">
                  Cached results are comparison evidence only. Missing LRNs,
                  empty grade coercion, and stale caches can cause differences.
                </p>
                <div className="max-h-64 overflow-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Sheet / cell</th>
                        <th>Field</th>
                        <th>Cached</th>
                        <th>Recalculated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mismatches.map((m, i) => (
                        <tr key={i}>
                          <td>
                            {m.source.sheet}!{m.source.cell}
                          </td>
                          <td>{m.field}</td>
                          <td>{String(m.cached)}</td>
                          <td>
                            {m.recalculated == null
                              ? "blank"
                              : String(m.recalculated)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </details>
            <ErrorBox error={plan?.errors.join(" ")} />
            <label className="mt-5 flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              <span>
                I've checked the class details, learners, scores, and grading
                rules.{" "}
                {d.config.resolved
                  ? "Grading configuration is resolved."
                  : "Affected grades will be provisional."}
              </span>
            </label>
            <label className="mt-4 flex items-center gap-3 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={retain}
                onChange={(e) => setRetain(e.target.checked)}
              />
              Keep a private copy of this workbook (optional).
            </label>
            <div className="mt-5">
              <Button
                disabled={
                  duplicates.isLoading ||
                  !!duplicates.error ||
                  (target === "new" &&
                    !!duplicates.data?.length &&
                    !allowDuplicateFile) ||
                  !reviewed ||
                  !!plan?.errors.length ||
                  busy ||
                  (target !== "new" && !existing.data)
                }
                onClick={() => {
                  if (!plan || !d) return;
                  setConfirmation({
                    token: crypto.randomUUID(),
                    payload: buildPayload(
                      d,
                      existing.data,
                      strategy,
                      allowMissing,
                      allowDuplicateFile,
                    ),
                    plan,
                  });
                }}
              >
                Continue to final check
                <ArrowRight size={16} />
              </Button>
              <p className="mt-3 text-xs text-slate-500" role="status">
                {plan?.errors.length
                  ? "Complete the checks above before continuing."
                  : !reviewed
                    ? "Tick the review checkbox above when you're ready."
                    : "Everything is ready for the final check."}
              </p>
            </div>
          </Card>
        </div>
      )}
      {confirmation && (
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck className="text-primary" />
              One last check
            </h2>
            <p className="text-sm text-slate-500">
              {target === "new"
                ? "Create a new class"
                : "Update the selected class"}
              : {d!.info.section} · {d!.info.subject}. Existing learners stay in
              the class.
            </p>
            <div className="my-5 grid gap-4 sm:grid-cols-4">
              {[
                ["New learners", confirmation.plan.newLearners],
                ["Existing learners matched", confirmation.plan.mappedLearners],
                ["New assessments", confirmation.plan.newAssessments],
                [
                  "Score updates",
                  confirmation.plan.changes.filter((c) => c.action === "Update")
                    .length,
                ],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">{k}</p>
                  <p className="mt-2 text-2xl font-semibold">{v}</p>
                </div>
              ))}
            </div>
            <p className="text-sm">
              Existing scores:{" "}
              <strong>
                {
                  {
                    new: "New class",
                    keep: "Keep saved scores",
                    fill: "Fill empty scores only",
                    replace: "Use this file's scores",
                  }[strategy]
                }
              </strong>{" "}
              · Insert score cells:{" "}
              {
                confirmation.plan.changes.filter((c) => c.action === "Insert")
                  .length
              }{" "}
              · Keep / unchanged:{" "}
              {
                confirmation.plan.changes.filter((c) =>
                  ["Keep", "Unchanged"].includes(c.action),
                ).length
              }
            </p>
            <p className="mt-3 text-xs text-slate-500">
              {!d!.config.resolved
                ? "Unresolved grading configuration: grades will be provisional."
                : ""}{" "}
              {retain
                ? "A private copy of your workbook will also be saved."
                : "Original file will not be stored."}
            </p>
          </Card>
          <Card className="p-6">
            <details
              className="import-details"
              open={target !== "new" || undefined}
            >
              <summary>See the scores that will be imported</summary>
              <div className="mb-4 mt-4 flex justify-between">
                <h2 className="font-semibold">Score details</h2>
                <select
                  aria-label="Filter changes"
                  value={changeFilter}
                  onChange={(e) => setChangeFilter(e.target.value)}
                >
                  <option value="all">All cells</option>
                  <option>Update</option>
                  <option>Insert</option>
                  <option>Keep</option>
                  <option>Unchanged</option>
                </select>
              </div>
              <div className="max-h-96 overflow-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Learner</th>
                      <th>Assessment</th>
                      <th>Source</th>
                      <th>Before</th>
                      <th>After</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmation.plan.changes
                      .filter(
                        (c) =>
                          changeFilter === "all" || c.action === changeFilter,
                      )
                      .map((c, i) => (
                        <tr key={i}>
                          <td>{c.learner}</td>
                          <td>{c.assessment}</td>
                          <td className="text-xs">{c.source}</td>
                          <td>{c.before === null ? "blank" : c.before}</td>
                          <td>{c.after === null ? "blank" : c.after}</td>
                          <td>
                            <span
                              className={
                                "badge " +
                                (c.action === "Update"
                                  ? "bg-amber-50 text-amber-900"
                                  : "bg-slate-100 text-slate-600")
                              }
                            >
                              {c.action}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Card>
          <div className="flex justify-between">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Back to review
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const result = await rpc<{
                    class_id: string;
                    batch_id: string;
                  }>("import_class_record", {
                    payload: confirmation.payload,
                    confirmation_token: confirmation.token,
                  });
                  if (retain && file) {
                    const {
                      data: { user },
                    } = await supabase.auth.getUser();
                    const object =
                      user!.id +
                      "/" +
                      result.class_id +
                      "/" +
                      result.batch_id +
                      "/" +
                      encodeURIComponent(file.name);
                    const { error } = await supabase.storage
                      .from("workbooks")
                      .upload(object, file, {
                        upsert: false,
                        contentType: /\.csv$/i.test(file.name)
                          ? "text/csv"
                          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                      });
                    if (error && !error.message.includes("already exists")) {
                      await qc.invalidateQueries();
                      setError(
                        "Database import completed. Original-file storage failed: " +
                          error.message +
                          " Open the imported class from My classes.",
                      );
                      return;
                    }
                  }
                  await qc.invalidateQueries();
                  nav("/classes/" + result.class_id);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Check size={16} />
              {busy
                ? "Importing your class…"
                : target === "new"
                  ? "Import class record"
                  : "Update class record"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
