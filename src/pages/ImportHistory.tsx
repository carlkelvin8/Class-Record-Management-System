import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchAllPages } from "../lib/pagination";
import { supabase } from "../lib/supabase";
import {
  PageTitle,
  Card,
  Loading,
  ErrorBox,
  EmptyState,
  Button,
} from "../components/common";
interface Batch {
  id: string;
  class_id: string;
  owner_id: string;
  filename: string;
  fingerprint: string;
  strategy: string;
  summary: Record<string, number>;
  created_at: string;
}
export function ImportHistory() {
  const [error, setError] = useState(""),
    [detail, setDetail] = useState<
      | {
          sheet: string;
          cell: string;
          kind: string;
          record_key: string;
          formula: string | null;
        }[]
      | null
    >(null);
  const q = useQuery({
    queryKey: ["history"],
    queryFn: () =>
      fetchAllPages<Batch>(
        async (from, to) =>
          await supabase
            .from("import_batches")
            .select("*")
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to),
      ),
  });
  return (
    <>
      <PageTitle
        title="Import history"
        description="A traceable record of confirmed workbook imports."
      />
      <ErrorBox error={q.error || error} />
      {q.isLoading ? (
        <Loading />
      ) : !q.data?.length ? (
        <EmptyState
          title="No imports yet"
          description="Confirmed workbook imports will appear here."
        />
      ) : (
        <Card className="overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Workbook</th>
                <th>Imported</th>
                <th>Strategy</th>
                <th>Changes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((b) => (
                <tr key={b.id}>
                  <td>
                    <p className="font-medium">{b.filename}</p>
                    <p className="mt-1 font-mono text-[10px] text-slate-400">
                      {b.fingerprint.slice(0, 16)}…
                    </p>
                  </td>
                  <td>{new Date(b.created_at).toLocaleString()}</td>
                  <td>{b.strategy}</td>
                  <td className="text-xs">
                    {b.summary.inserted_scores} inserted ·{" "}
                    {b.summary.changed_scores} updated · {b.summary.kept_scores}{" "}
                    kept
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm">
                        <Link to={"/classes/" + b.class_id}>Open class</Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try {
                            const data = await fetchAllPages<
                              NonNullable<typeof detail>[number]
                            >(
                              async (from, to) =>
                                await supabase
                                  .from("import_provenance")
                                  .select("sheet,cell,kind,record_key,formula")
                                  .eq("batch_id", b.id)
                                  .order("id")
                                  .range(from, to),
                            );
                            setDetail(data);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Provenance
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try {
                            const folder =
                              b.owner_id + "/" + b.class_id + "/" + b.id;
                            const { data, error } = await supabase.storage
                              .from("workbooks")
                              .list(folder);
                            if (error) throw error;
                            if (!data?.length)
                              throw Error(
                                "No original file was retained for this import.",
                              );
                            const r = await supabase.storage
                              .from("workbooks")
                              .createSignedUrl(folder + "/" + data[0].name, 60);
                            if (r.error) throw r.error;
                            window.open(
                              r.data.signedUrl,
                              "_blank",
                              "noopener,noreferrer",
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Original (60s link)
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      {detail && (
        <Card className="mt-6 p-6">
          <div className="flex justify-between">
            <h2 className="font-semibold">Import provenance</h2>
            <Button variant="ghost" onClick={() => setDetail(null)}>
              Close
            </Button>
          </div>
          <div className="mt-4 max-h-96 overflow-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Sheet / address</th>
                  <th>Source formula (not executed)</th>
                </tr>
              </thead>
              <tbody>
                {detail.map((p, i) => (
                  <tr key={i}>
                    <td>{p.kind}</td>
                    <td>
                      {p.sheet}!{p.cell}
                    </td>
                    <td className="max-w-lg break-all font-mono text-xs">
                      {p.formula ?? "Raw input"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
