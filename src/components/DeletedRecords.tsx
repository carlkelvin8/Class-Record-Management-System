import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { rpc } from "../lib/api";
import { Button, ErrorBox, Loading } from "./common";
export function DeletedRecords({
  classId,
  revision,
  onSaved,
}: {
  classId: string;
  revision: number;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const q = useQuery({
    queryKey: ["class", classId, "deleted", page],
    enabled: open,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("deleted_records")
        .select("id,kind,name,deleted_at", { count: "exact" })
        .eq("class_id", classId)
        .is("restored_at", null)
        .order("deleted_at", { ascending: false })
        .order("id")
        .range(page * 10, page * 10 + 9);
      if (error) throw Error(error.message);
      return { rows: data ?? [], total: count ?? 0 };
    },
  });
  return (
    <section className="my-4 rounded-xl border border-slate-200 bg-white p-4">
      <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
        {open ? "Close deleted records" : "Deleted records / Restore"}
      </Button>
      {open && (
        <div className="mt-4">
          <p className="mb-3 text-sm text-slate-500">
            Restore a deleted learner or assessment together with its saved
            scores.
          </p>
          <ErrorBox error={error || q.error} />
          <p role="status" className="text-sm text-emerald-700">
            {message}
          </p>
          {q.isLoading ? (
            <Loading />
          ) : q.data?.rows.length ? (
            q.data.rows.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-4 border-b py-3"
              >
                <div>
                  <strong className="text-sm">{r.name}</strong>
                  <p className="text-xs text-slate-500">
                    {r.kind} / Deleted {new Date(r.deleted_at).toLocaleString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    setMessage("");
                    try {
                      await rpc("restore_record", {
                        p_class: classId,
                        p_expected_revision: revision,
                        p_deleted: r.id,
                      });
                      if (q.data?.rows.length === 1 && page > 0)
                        setPage(page - 1);
                      await onSaved();
                      setMessage(`${r.name} restored with saved scores.`);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Restore
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm">No deleted records.</p>
          )}
          {(q.data?.total ?? 0) > 10 && (
            <div className="mt-3 flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || page === 0}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span className="text-xs">
                Page {page + 1} of {Math.ceil((q.data?.total ?? 0) / 10)}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || (page + 1) * 10 >= (q.data?.total ?? 0)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
