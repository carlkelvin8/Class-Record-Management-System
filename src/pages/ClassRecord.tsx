import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import {
  Download,
  Plus,
  Settings,
  ArrowLeft,
  RefreshCw,
  Pencil,
} from "lucide-react";
import {
  useBundle,
  useRecordPage,
  getRecordExport,
  rpc,
  exportCsv,
  type Bundle,
} from "../lib/api";
import type {
  Config,
  Enrollment,
  Score,
  Assessment,
  Category,
} from "../lib/types";
import {
  PageTitle,
  Card,
  Button,
  Input,
  Loading,
  ErrorBox,
  Status,
  ConfigForm,
  InfoForm,
  Field,
} from "../components/common";
import { RecordPagination } from "../components/RecordPagination";
import { DeleteRecord } from "../components/DeleteRecord";
const display = (v: number | null | undefined) =>
  v == null ? "—" : Number.isInteger(v) ? v.toString() : v.toFixed(2);
function ClassNav({ id, active }: { id: string; active: string }) {
  return (
    <div className="mb-6 flex gap-6 overflow-x-auto border-b border-border text-sm">
      {[
        ["", "Class record"],
        ["/final", "Final grades"],
        ["/configuration", "Grading configuration"],
      ].map(([s, t]) => (
        <Link
          key={s}
          to={"/classes/" + id + s}
          className={
            "whitespace-nowrap border-b-2 pb-3 " +
            (active === s
              ? "border-primary font-semibold text-primary"
              : "border-transparent text-slate-500")
          }
        >
          {t}
        </Link>
      ))}
    </div>
  );
}
function ScoreCell({
  score,
  learner,
  assessment,
  classId,
  onSaved,
}: {
  score?: Score;
  learner: Enrollment;
  assessment: Assessment;
  classId: string;
  onSaved: () => Promise<void>;
}) {
  const cancelNextSave = useRef(false);
  const [text, setText] = useState(
      score?.value == null ? "" : String(score.value),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [version, setVersion] = useState<number | null>(score?.version ?? null);
  useEffect(() => {
    if (!editing && !error)
      setText(score?.value == null ? "" : String(score.value));
  }, [score?.value, editing, error]);
  const save = async () => {
    if (cancelNextSave.current) {
      cancelNextSave.current = false;
      return;
    }
    if (busy) return;
    const val = text.trim() === "" ? null : Number(text);
    if (val === score?.value || (val === null && !score)) {
      setEditing(false);
      return;
    }
    if (
      val !== null &&
      (!Number.isFinite(val) || val < 0 || val > assessment.maximum)
    ) {
      setError("Score must be 0–" + assessment.maximum);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await rpc("save_score", {
        p_class: classId,
        p_enrollment: learner.id,
        p_assessment: assessment.id,
        p_value: val,
        p_expected_version: version,
      });
      setEditing(false);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative">
      <input
        aria-label={learner.name + " · " + assessment.name}
        title={
          error || "Maximum " + assessment.maximum + " · blank means unentered"
        }
        inputMode="decimal"
        className={"score-input " + (error ? "border-red-400 bg-red-50" : "")}
        disabled={busy}
        value={text}
        onFocus={() => {
          if (!editing) {
            setVersion(score?.version ?? null);
            setEditing(true);
          }
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelNextSave.current = true;
            setText(score?.value == null ? "" : String(score.value));
            setError("");
            setEditing(false);
            e.currentTarget.blur();
          }
        }}
      />
      {busy && <span className="block text-[9px] text-primary">Saving…</span>}
      {error && (
        <div role="alert" className="max-w-40 text-[10px] text-red-700">
          {error}
          <button
            className="block underline"
            onClick={async () => {
              await onSaved();
              setEditing(false);
              setError("");
            }}
          >
            Refresh & discard edit
          </button>
        </div>
      )}
    </div>
  );
}
function LearnerForm({
  b,
  onSaved,
  initial,
  onClose,
}: {
  b: Bundle;
  onSaved: () => Promise<void>;
  initial?: Enrollment | null;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(initial?.id ?? "new"),
    [name, setName] = useState(initial?.name ?? ""),
    [lrn, setLrn] = useState(initial?.lrn ?? ""),
    [sex, setSex] = useState(initial?.sex ?? "unspecified"),
    [confirmed, setConfirmed] = useState(!!initial && !initial.lrn),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Card className="mb-6 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Add or edit learner</h2>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Learner (current page)">
          <select
            aria-label="Learner (current page)"
            className="w-full"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              const l = b.learners.find((l) => l.id === e.target.value);
              setName(l?.name ?? "");
              setLrn(l?.lrn ?? "");
              setSex(l?.sex ?? "unspecified");
              setConfirmed(!!l && !l.lrn);
            }}
          >
            <option value="new">New learner</option>
            {initial && !b.learners.some((l) => l.id === initial.id) && (
              <option value={initial.id}>{initial.name}</option>
            )}
            {b.learners.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="LRN (12 digits; optional)">
          <Input
            inputMode="numeric"
            value={lrn}
            onChange={(e) => setLrn(e.target.value)}
          />
        </Field>
        <Field label="Sex / group">
          <select value={sex} onChange={(e) => setSex(e.target.value)}>
            <option>unspecified</option>
            <option>male</option>
            <option>female</option>
          </select>
        </Field>
      </div>
      {!lrn && (
        <label className="mt-4 flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          Use an application identifier. Final grade remains provisional without
          an LRN.
        </label>
      )}
      <ErrorBox error={error} />
      <Button
        className="mt-4"
        disabled={
          busy ||
          !name.trim() ||
          (!lrn && !confirmed) ||
          (!!lrn && !/^\d{12}$/.test(lrn))
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await rpc("manage_record", {
              p_class: b.info.id,
              p_expected_revision: b.info.revision,
              p_action: "learner",
              p_data: {
                id: target === "new" ? null : target,
                name,
                lrn: lrn || null,
                sex,
              },
            });
            await onSaved();
            setTarget("new");
            setName("");
            setLrn("");
            setConfirmed(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Saving…"
          : target === "new"
            ? "Add learner"
            : "Save learner changes"}
      </Button>
      {target !== "new" && (
        <DeleteRecord
          key={target}
          classId={b.info.id}
          revision={b.info.revision}
          kind="learner"
          id={target}
          name={b.learners.find((l) => l.id === target)?.name ?? name}
          onSaved={onSaved}
          onDeleted={() => {
            setTarget("new");
            setName("");
            setLrn("");
            setConfirmed(false);
          }}
        />
      )}
    </Card>
  );
}
function AssessmentForm({
  b,
  term,
  onSaved,
}: {
  b: Bundle;
  term: number;
  onSaved: () => Promise<void>;
}) {
  const [target, setTarget] = useState("new"),
    [name, setName] = useState(""),
    [max, setMax] = useState(10),
    [cat, setCat] = useState("ww"),
    [sub, setSub] = useState("ST1"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const t = b.terms.find((t) => t.number === term);
  return (
    <Card className="mb-6 p-5">
      <h2 className="mb-4 font-semibold">Manage assessments · Term {term}</h2>
      <div className="grid gap-4 md:grid-cols-5">
        <Field label="Assessment">
          <select
            aria-label="Assessment"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              const a = b.assessments.find((a) => a.id === e.target.value);
              setName(a?.name ?? "");
              setMax(a?.maximum ?? 10);
              setCat(
                b.categories.find((c) => c.id === a?.category_id)?.code ?? "ww",
              );
              setSub(a?.subcomponent ?? "ST1");
            }}
          >
            <option value="new">New assessment</option>
            {b.assessments
              .filter((a) => a.term_id === t?.id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Maximum score">
          <Input
            type="number"
            min="0.01"
            step="any"
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
          />
        </Field>
        <Field label="Component">
          <select
            disabled={target !== "new"}
            value={cat}
            onChange={(e) => setCat(e.target.value)}
          >
            <option value="ww">Written / Oral</option>
            <option value="pt">Performance</option>
            <option value="ex">Examinations</option>
          </select>
        </Field>
        {cat === "ex" && (
          <Field label="Examination">
            <select
              disabled={target !== "new"}
              value={sub}
              onChange={(e) => setSub(e.target.value)}
            >
              <option>ST1</option>
              <option>ST2</option>
              <option>TE</option>
            </select>
          </Field>
        )}
      </div>
      <ErrorBox error={error} />
      <Button
        className="mt-4"
        disabled={
          busy || !name.trim() || !Number.isFinite(max) || max <= 0 || !t
        }
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await rpc("manage_record", {
              p_class: b.info.id,
              p_expected_revision: b.info.revision,
              p_action: "assessment",
              p_data: {
                id: target === "new" ? null : target,
                name,
                maximum: max,
                term_id: t?.id,
                category_id: b.categories.find((c) => c.code === cat)?.id,
                subcomponent: cat === "ex" ? sub : null,
                ordinal: b.assessments.length,
              },
            });
            await onSaved();
            setTarget("new");
            setName("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Saving…"
          : target === "new"
            ? "Add assessment"
            : "Save assessment changes"}
      </Button>
      {target !== "new" && (
        <DeleteRecord
          key={target}
          classId={b.info.id}
          revision={b.info.revision}
          kind="assessment"
          id={target}
          name={b.assessments.find((a) => a.id === target)?.name ?? name}
          onSaved={onSaved}
          onDeleted={() => {
            setTarget("new");
            setName("");
          }}
        />
      )}
    </Card>
  );
}
export function ClassRecord() {
  const { id } = useParams(),
    qc = useQueryClient();
  const [term, setTerm] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [sorting, setSorting] = useState<SortingState>([
      { id: "learner", desc: false },
    ]),
    [learnerForm, setLearnerForm] = useState(false),
    [assessmentForm, setAssessmentForm] = useState(false);
  const [page, setPage] = useState(0),
    [pageSize, setPageSize] = useState(10);
  const [selectedLearner, setSelectedLearner] = useState<Enrollment | null>(
    null,
  );
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState("");
  const options = {
    page,
    pageSize,
    search,
    status,
    sort: sorting[0]?.id ?? "learner",
    desc: sorting[0]?.desc ?? false,
    term,
  };
  const q = useRecordPage(id, options);
  useEffect(() => {
    if (q.data && !q.isPlaceholderData) setPage(q.data.page);
  }, [q.data, q.isPlaceholderData]);
  const b = q.data;
  useEffect(() => {
    if (b && !b.config.applicable_terms.includes(term))
      setTerm(b.config.applicable_terms[0]);
  }, [b, term]);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["class", id] });
    await qc.invalidateQueries({ queryKey: ["classes"] });
  };
  const aa = useMemo(
    () =>
      b?.assessments
        .filter((a) => a.term_id === b.terms.find((t) => t.number === term)?.id)
        .sort((a, b) => a.ordinal - b.ordinal) ?? [],
    [b, term],
  );
  const grade = (l: Enrollment) =>
    b?.termGrades.find((g) => g.enrollment_id === l.id && g.number === term)
      ?.result;
  const columns = useMemo<ColumnDef<Enrollment>[]>(() => {
    if (!b) return [];
    return [
      {
        id: "learner",
        header: "Learner",
        accessorFn: (l) => l.name,
        cell: ({ row }) => (
          <div className="min-w-[215px]">
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-medium">{row.original.name}</span>
              <button
                className="rounded p-1 text-slate-400 hover:bg-stone-100 hover:text-primary"
                aria-label={"Edit learner " + row.original.name}
                title="Edit learner details"
                onClick={() => {
                  setSelectedLearner(row.original);
                  setLearnerForm(true);
                }}
              >
                <Pencil size={13} />
              </button>
            </div>
            <span className="mt-1 block font-mono text-[10px] text-slate-400">
              {row.original.lrn ?? "App ID · " + row.original.id.slice(0, 8)}
            </span>
          </div>
        ),
      },
      ...(["ww", "pt", "ex"] as Category[]).map((code) => ({
        id: code,
        header:
          (code === "ww"
            ? "Written / Oral Works"
            : code === "pt"
              ? "Product / Performance Tasks"
              : "Examinations") +
          " · " +
          b.config.weights[code] +
          "%",
        columns: [
          ...aa
            .filter(
              (a) =>
                b.categories.find((c) => c.id === a.category_id)?.code === code,
            )
            .map((a) => ({
              id: a.id,
              header: () => (
                <div className="text-center">
                  <span>{a.name}</span>
                  <span className="mt-1 block text-[10px] font-normal normal-case">
                    max {a.maximum}
                    {a.subcomponent
                      ? " · " + b.config.subweights[a.subcomponent] + "%"
                      : ""}
                  </span>
                </div>
              ),
              enableSorting: false,
              cell: ({ row }: { row: { original: Enrollment } }) => (
                <ScoreCell
                  classId={b.info.id}
                  learner={row.original}
                  assessment={a}
                  score={b.scores.find(
                    (s) =>
                      s.enrollment_id === row.original.id &&
                      s.assessment_id === a.id,
                  )}
                  onSaved={refresh}
                />
              ),
            })),
          ...(["total", "ps", "ws"] as const).map((field) => ({
            id: code + "." + field,
            header: field.toUpperCase(),
            accessorFn: (l: Enrollment) =>
              grade(l)?.components[code][field] ?? null,
            cell: ({ row }: { row: { original: Enrollment } }) =>
              display(grade(row.original)?.components[code][field]),
          })),
          ...(code === "ex"
            ? (["ST1", "ST2", "TE"] as const).map((s) => ({
                id: "sub" + s,
                header: "WS " + s,
                accessorFn: (l: Enrollment) => grade(l)?.exam[s] ?? null,
                cell: ({ row }: { row: { original: Enrollment } }) =>
                  display(grade(row.original)?.exam[s]),
              }))
            : []),
        ],
      })),
      {
        id: "initial",
        header: "Initial",
        accessorFn: (l) => grade(l)?.initial,
        cell: ({ row }) => display(grade(row.original)?.initial),
      },
      {
        id: "grade",
        header: "Term grade",
        accessorFn: (l) => grade(l)?.grade,
        cell: ({ row }) => (
          <span className="font-semibold text-primary">
            {display(grade(row.original)?.grade)}
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Status
            incomplete={grade(row.original)?.incomplete}
            provisional={grade(row.original)?.provisional}
            remark={
              grade(row.original)?.grade == null
                ? null
                : grade(row.original)!.grade! >= b.config.passing_threshold
                  ? "PASSED"
                  : "FAILED"
            }
          />
        ),
      },
    ];
  }, [b, aa, term]);
  const data = b?.learners ?? [];
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: (next) => {
      setSorting(next);
      setPage(0);
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    getRowId: (row) => row.id,
  });
  if (q.isLoading) return <Loading />;
  if (!b) return <ErrorBox error={q.error || "Class not found"} />;
  return (
    <>
      <Link
        to="/classes"
        className="mb-4 inline-flex items-center gap-2 text-xs text-slate-500"
      >
        <ArrowLeft size={14} />
        My classes
      </Link>
      <PageTitle
        title={b.info.section}
        description={
          b.info.subject +
          " · Grade " +
          b.info.grade_level +
          " · " +
          b.info.school_year
        }
        actions={
          <Button
            variant="outline"
            disabled={exporting || q.isFetching}
            onClick={async () => {
              setExporting(true);
              setExportError("");
              try {
                const b = await getRecordExport(id!, options);
                const grade = (l: Enrollment) =>
                  b.termGrades.find(
                    (g) => g.enrollment_id === l.id && g.number === term,
                  )?.result;
                exportCsv(
                  b.info.section + "-term-" + term + ".csv",
                  [
                    "LRN",
                    "Name",
                    ...aa.map((a) => a.name + " (max " + a.maximum + ")"),
                    "WW total",
                    "WW PS",
                    "WW WS",
                    "PT total",
                    "PT PS",
                    "PT WS",
                    "EX total",
                    "EX PS",
                    "EX WS",
                    "WS ST1",
                    "WS ST2",
                    "WS TE",
                    "Initial grade",
                    "Term grade",
                    "Status",
                  ],
                  b.learners.map((l) => {
                    const g = grade(l);
                    return [
                      l.lrn,
                      l.name,
                      ...aa.map(
                        (a) =>
                          b.scores.find(
                            (s) =>
                              s.enrollment_id === l.id &&
                              s.assessment_id === a.id,
                          )?.value ?? null,
                      ),
                      ...(["ww", "pt", "ex"] as Category[]).flatMap((c) => [
                        g?.components[c].total,
                        g?.components[c].ps,
                        g?.components[c].ws,
                      ]),
                      g?.exam.ST1,
                      g?.exam.ST2,
                      g?.exam.TE,
                      g?.initial,
                      g?.grade,
                      g?.provisional
                        ? "Provisional"
                        : g?.incomplete
                          ? "Incomplete"
                          : "Complete",
                    ];
                  }),
                );
              } catch (e) {
                setExportError((e as Error).message);
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download size={16} />
            Export CSV
          </Button>
        }
      />
      <ClassNav id={id!} active="" />
      <ErrorBox error={q.error || exportError} />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-lg border border-border bg-white p-1">
          {[1, 2, 3].map((t) => (
            <Button
              key={t}
              variant={term === t ? "default" : "ghost"}
              size="sm"
              disabled={!b.config.applicable_terms.includes(t)}
              onClick={() => {
                setTerm(t);
                setPage(0);
              }}
            >
              Term {t}
              {!b.config.applicable_terms.includes(t) ? " · N/A" : ""}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={q.isPlaceholderData}
            onClick={() => {
              setSelectedLearner(null);
              setLearnerForm(true);
            }}
          >
            <Plus size={14} />
            Add learner
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={q.isPlaceholderData}
            onClick={() => setAssessmentForm(!assessmentForm)}
          >
            <Pencil size={14} />
            Manage assessments
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/classes/${id}/configuration`}>
              <Settings size={14} /> Edit class details
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh records"
            onClick={refresh}
          >
            <RefreshCw size={15} />
          </Button>
        </div>
      </div>
      {learnerForm && (
        <fieldset disabled={q.isPlaceholderData}>
          <LearnerForm
            key={selectedLearner?.id ?? "new"}
            initial={selectedLearner}
            b={b}
            onClose={() => setLearnerForm(false)}
            onSaved={async () => {
              setLearnerForm(false);
              setSelectedLearner(null);
              await refresh();
            }}
          />
        </fieldset>
      )}
      {assessmentForm && (
        <fieldset disabled={q.isPlaceholderData}>
          <AssessmentForm key={term} b={b} term={term} onSaved={refresh} />
        </fieldset>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-sm font-semibold">Term {term} class record</h2>
            <p className="mt-1 text-xs text-slate-400">
              {b.total} learners · {aa.length} assessments · raw scores are
              editable
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              className="max-w-56"
              placeholder="Search name or LRN…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <select
              aria-label="Filter records"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All records</option>
              <option value="incomplete">Incomplete / provisional</option>
              <option value="below">Below passing threshold</option>
            </select>
          </div>
        </div>
        <div
          aria-busy={q.isFetching}
          className={
            "max-h-[65vh] overflow-auto " +
            (q.isPlaceholderData ? "pointer-events-none opacity-50" : "")
          }
        >
          <table className="data-table record-table">
            <thead className="sticky top-0 z-20">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      colSpan={h.colSpan}
                      className={
                        h.column.id === "learner" ? "learner-sticky" : ""
                      }
                    >
                      {h.isPlaceholder ? null : (
                        <button
                          className="w-full"
                          onClick={h.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            h.column.columnDef.header,
                            h.getContext(),
                          )}
                          {h.column.getIsSorted() === "asc"
                            ? " ↑"
                            : h.column.getIsSorted() === "desc"
                              ? " ↓"
                              : ""}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={
                        cell.column.id === "learner"
                          ? "learner-sticky"
                          : cell.column.id.includes(".") ||
                              ["initial", "grade"].includes(cell.column.id)
                            ? "calculated"
                            : ""
                      }
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!data.length && (
            <p className="p-8 text-sm text-slate-500">
              No learners match these filters. Clear the filters or add a
              learner.
            </p>
          )}
        </div>
        <RecordPagination
          page={b.page}
          size={pageSize}
          total={b.total}
          busy={q.isFetching}
          onPage={setPage}
          onSize={(n) => {
            setPageSize(n);
            setPage(0);
          }}
        />
        <div className="flex flex-wrap justify-between gap-2 p-4 text-[11px] text-slate-500">
          <span>
            Blank = unentered · 0 = entered zero · Enter to save · Escape to
            cancel
          </span>
          <span>
            Calculated columns are read-only · grades calculated in PostgreSQL
          </span>
        </div>
      </Card>
      {!aa.length && (
        <p className="mt-4 text-sm text-amber-800">
          This applicable term has no assessments. Its results remain
          incomplete.
        </p>
      )}
    </>
  );
}
export function FinalGrades() {
  const { id } = useParams(),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("name");
  const [page, setPage] = useState(0),
    [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState("");
  const options = {
    page,
    pageSize,
    search,
    status: filter,
    sort: sort === "name" ? "learner" : "grade",
    desc: sort === "grade",
    term: 1,
    final: true,
  };
  const q = useRecordPage(id, options);
  useEffect(() => {
    if (q.data && !q.isPlaceholderData) setPage(q.data.page);
  }, [q.data, q.isPlaceholderData]);
  const b = q.data;
  if (q.isLoading) return <Loading />;
  if (!b) return <ErrorBox error={q.error} />;
  const ls = b.learners;
  const output = (b: Bundle) =>
    b.learners.map((l) => {
      const f = b.finalGrades.find((g) => g.enrollment_id === l.id)?.result;
      return [
        l.lrn,
        l.name,
        ...[1, 2, 3].map(
          (t) =>
            b.termGrades.find((g) => g.enrollment_id === l.id && g.number === t)
              ?.result.grade ?? null,
        ),
        f?.final,
        f?.descriptor,
        f?.remark,
        f?.provisional
          ? "Provisional"
          : f?.incomplete
            ? "Incomplete"
            : "Complete",
      ];
    });
  return (
    <>
      <PageTitle
        title="Final grades"
        description={b.info.section + " · " + b.info.subject}
        actions={
          <Button
            variant="outline"
            disabled={exporting || q.isFetching}
            onClick={async () => {
              setExporting(true);
              setExportError("");
              try {
                const all = await getRecordExport(id!, options);
                exportCsv(
                  b.info.section + "-final.csv",
                  [
                    "LRN",
                    "Name",
                    "Term 1",
                    "Term 2",
                    "Term 3",
                    "Final",
                    "Descriptor",
                    "Remark",
                    "Status",
                  ],
                  output(all),
                );
              } catch (e) {
                setExportError((e as Error).message);
              } finally {
                setExporting(false);
              }
            }}
          >
            <Download size={16} />
            Export CSV
          </Button>
        }
      />
      <ClassNav id={id!} active="/final" />
      <ErrorBox error={q.error || exportError} />
      <Card className="mb-5 p-5 text-sm">
        <strong>
          Applicable terms: {b.config.applicable_terms.join(", ")}
        </strong>
        <p className="mt-2 text-slate-500">
          Final = rounded (sum of applicable term grades ×{" "}
          {b.config.units_per_term} units / {b.config.units_per_year} annual
          units). Passing threshold: {b.config.passing_threshold}. Missing LRNs
          keep final grades provisional, following the source workbook.
        </p>
      </Card>
      <div className="mb-5 flex flex-wrap gap-3">
        <Input
          className="max-w-sm"
          placeholder="Search learners…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
          aria-label="Filter final grades"
        >
          <option value="all">All learners</option>
          <option value="incomplete">Incomplete / provisional</option>
          <option value="failed">Failed (complete only)</option>
        </select>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(0);
          }}
          aria-label="Sort final grades"
        >
          <option value="name">Name A–Z</option>
          <option value="grade">Highest final grade</option>
        </select>
      </div>
      <Card
        className={
          "overflow-auto " +
          (q.isPlaceholderData ? "pointer-events-none opacity-50" : "")
        }
        aria-busy={q.isFetching}
      >
        <table className="data-table">
          <thead>
            <tr>
              <th>Learner</th>
              {[1, 2, 3].map((t) => (
                <th key={t}>Term {t}</th>
              ))}
              <th>Final</th>
              <th>Descriptor</th>
              <th>Remark</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ls.map((l) => {
              const f = b.finalGrades.find(
                (g) => g.enrollment_id === l.id,
              )?.result;
              return (
                <tr key={l.id}>
                  <td>
                    <p className="font-medium">{l.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">
                      {l.lrn ?? "Application ID: " + l.id.slice(0, 8)}
                    </p>
                  </td>
                  {[1, 2, 3].map((t) => (
                    <td key={t}>
                      {b.config.applicable_terms.includes(t)
                        ? display(
                            b.termGrades.find(
                              (g) => g.enrollment_id === l.id && g.number === t,
                            )?.result.grade,
                          )
                        : "N/A"}
                    </td>
                  ))}
                  <td className="font-semibold text-primary">
                    {display(f?.final)}
                  </td>
                  <td>{f?.descriptor ?? "—"}</td>
                  <td>{f?.remark ?? "—"}</td>
                  <td>
                    <Status
                      incomplete={f?.incomplete}
                      provisional={f?.provisional}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!ls.length && (
          <p className="p-6 text-sm text-slate-500">
            No learners match these filters.
          </p>
        )}
        <RecordPagination
          page={b.page}
          size={pageSize}
          total={b.total}
          busy={q.isFetching}
          onPage={setPage}
          onSize={(n) => {
            setPageSize(n);
            setPage(0);
          }}
        />
      </Card>
    </>
  );
}
export function Configuration() {
  const { id } = useParams(),
    q = useBundle(id),
    qc = useQueryClient(),
    [config, setConfig] = useState<Config | null>(null),
    [info, setInfo] = useState<Bundle["info"] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.data) {
      setConfig(q.data.config);
      setInfo(q.data.info);
    }
  }, [q.data]);
  if (q.isLoading) return <Loading />;
  if (!q.data || !config || !info) return <ErrorBox error={q.error} />;
  const save = async (action: string, data: unknown) => {
    setBusy(true);
    setError("");
    try {
      await rpc("manage_record", {
        p_class: id,
        p_expected_revision: q.data!.info.revision,
        p_action: action,
        p_data: data,
      });
      await qc.invalidateQueries({ queryKey: ["class", id] });
      await qc.invalidateQueries({ queryKey: ["classes"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        title="Grading configuration"
        description={
          q.data.info.section + " · Source inputs and calculation rules"
        }
      />
      <ClassNav id={id!} active="/configuration" />
      <ErrorBox error={error} />
      <Card className="mb-6 space-y-5 p-6">
        <h2 className="font-semibold">Grading rules</h2>
        <ConfigForm value={config} onChange={setConfig} />
        <Button disabled={busy} onClick={() => save("configuration", config)}>
          <Settings size={16} />
          {busy ? "Saving…" : "Save and recalculate"}
        </Button>
      </Card>
      <Card className="space-y-5 p-6">
        <h2 className="font-semibold">Class information</h2>
        <InfoForm value={info} onChange={(v) => setInfo({ ...info, ...v })} />
        <Button disabled={busy} onClick={() => save("class", info)}>
          Save class information
        </Button>
      </Card>
    </>
  );
}
