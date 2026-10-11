import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, BookOpen, ArrowUpRight, Search } from "lucide-react";
import { useClasses, rpc } from "../lib/api";
import { emptyInfo } from "../lib/class-info";
import reference from "../lib/reference-config.json";
import type { Config } from "../lib/types";
import {
  PageTitle,
  Card,
  Button,
  Input,
  InfoForm,
  ConfigForm,
  Loading,
  ErrorBox,
  EmptyState,
} from "../components/common";
export function Classes() {
  const q = useClasses(),
    nav = useNavigate(),
    qc = useQueryClient();
  const [search, setSearch] = useState(""),
    [show, setShow] = useState(false),
    [info, setInfo] = useState(emptyInfo()),
    [config, setConfig] = useState<Config>({
      ...(reference as Config),
      resolved: false,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const filtered =
    q.data?.filter((c) =>
      (c.section + " " + c.subject + " " + c.school_year)
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <PageTitle
        title="My classes"
        description="A home for every section, subject, and school year."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/import">
                <Upload size={16} />
                Import workbook
              </Link>
            </Button>
            <Button onClick={() => setShow(!show)}>
              <Plus size={16} />
              New class
            </Button>
          </div>
        }
      />
      <ErrorBox error={q.error || error} />
      {show && (
        <Card className="mb-6 space-y-6 p-6">
          <h2 className="font-semibold">Create a class</h2>
          <InfoForm value={info} onChange={setInfo} />
          <p className="text-sm text-slate-500">
            The reference configuration is offered for explicit review. Select
            the applicable terms, weights and units for this class.
          </p>
          <ConfigForm value={config} onChange={setConfig} />
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const id = await rpc<string>("create_class", {
                  p_info: info,
                  p_config: config,
                });
                await qc.invalidateQueries({ queryKey: ["classes"] });
                nav("/classes/" + id);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create class"}
          </Button>
        </Card>
      )}
      <div className="class-search">
        <Search size={17} />
        <Input
          aria-label="Search classes or subjects"
          placeholder="Search classes or subjects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <EmptyState
          title="Start with your first class"
          description="Import your existing workbook or create a class and add learners."
          action={
            <Button asChild>
              <Link to="/import">Import a workbook</Link>
            </Button>
          }
        />
      ) : !filtered.length ? (
        <EmptyState
          title="No classes found"
          description="Try a different section, subject, or school year."
          action={
            <Button variant="outline" onClick={() => setSearch("")}>
              Clear search
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="class-card p-6">
              <div className="mb-6 flex items-center justify-between">
                <span className="class-book text-primary">
                  <BookOpen size={22} />
                </span>
                <span className="badge bg-slate-100 text-slate-500">
                  {c.archived ? "Archived" : c.school_year}
                </span>
              </div>
              <h2 className="text-xl font-semibold">{c.section}</h2>
              <p className="mt-1 text-sm text-slate-500">{c.subject}</p>
              <p className="mb-6 mt-4 text-xs text-slate-400">
                Grade {c.grade_level || "—"} · {c.cluster || "No cluster"}
                <br />
                {c.school}
              </p>
              <div className="flex justify-between border-t border-border pt-4">
                <Link
                  className="text-sm font-semibold text-primary"
                  to={"/classes/" + c.id}
                >
                  Open class record{" "}
                  <ArrowUpRight className="inline" size={15} />
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await rpc("manage_record", {
                        p_class: c.id,
                        p_expected_revision: c.revision,
                        p_action: "archive",
                        p_data: { archived: !c.archived },
                      });
                      await qc.invalidateQueries({ queryKey: ["classes"] });
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {c.archived ? "Restore" : "Archive"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
