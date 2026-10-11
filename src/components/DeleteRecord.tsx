import { useState } from "react";
import { Trash2 } from "lucide-react";
import { rpc } from "../lib/api";
import { Button, ErrorBox } from "./common";
export function DeleteRecord({
  classId,
  revision,
  kind,
  id,
  name,
  onSaved,
  onDeleted,
}: {
  classId: string;
  revision: number;
  kind: "learner" | "assessment";
  id: string;
  name: string;
  onSaved: () => Promise<void>;
  onDeleted?: () => void;
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="mt-3">
      {!confirm ? (
        <Button
          size="sm"
          variant="outline"
          className="border-red-200 text-red-700 hover:bg-red-50"
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={14} /> Delete {kind}
        </Button>
      ) : (
        <div
          role="alertdialog"
          aria-label={`Delete ${kind}`}
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <p className="font-medium">Delete {name}?</p>
          <p className="mt-1 text-xs leading-5">
            This moves this {kind} and its associated scores to Deleted records.
            Grades will recalculate. You can restore it from this class.
          </p>
          <ErrorBox error={error} />
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              className="bg-red-700 hover:bg-red-800"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await rpc("delete_record", {
                    p_class: classId,
                    p_expected_revision: revision,
                    p_kind: kind,
                    p_id: id,
                  });
                  setConfirm(false);
                  onDeleted?.();
                  await onSaved();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Deleting…" : `Confirm delete ${kind}`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
