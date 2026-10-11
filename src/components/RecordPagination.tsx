import { Button } from "./common";
export function RecordPagination({
  page,
  size,
  total,
  busy,
  onPage,
  onSize,
}: {
  page: number;
  size: number;
  total: number;
  busy: boolean;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <nav
      aria-label="Learner pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 text-xs text-slate-500"
    >
      <span role="status">
        {busy
          ? "Loading records…"
          : `${total ? page * size + 1 : 0}–${Math.min((page + 1) * size, total)} of ${total} learners`}
      </span>
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Rows per page{" "}
          <select
            aria-label="Rows per page"
            value={size}
            disabled={busy}
            onChange={(e) => onSize(Number(e.target.value))}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || page === 0}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <span>
          Page {page + 1} of {pages}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || page + 1 >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
