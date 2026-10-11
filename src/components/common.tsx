import type { ReactNode } from "react";
import { BookOpen, LoaderCircle } from "lucide-react";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import type { ClassInfo, Config } from "../lib/types";
import { emptyInfo } from "../lib/class-info";
import { validateConfig } from "../lib/grading";
export function PageTitle({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="page-heading text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
      </div>
      {actions}
    </div>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div
      role="alert"
      className="my-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div role="status" className="p-12 text-center text-slate-500">
      Loading your class records…
    </div>
  );
}
export function Status({
  incomplete,
  provisional,
  remark,
}: {
  incomplete?: boolean;
  provisional?: boolean;
  remark?: string | null;
}) {
  const label = provisional
    ? "Provisional"
    : incomplete
      ? "Incomplete"
      : (remark ?? "Complete");
  return (
    <span
      className={
        "badge " +
        (provisional || incomplete
          ? "bg-amber-50 text-amber-800"
          : remark === "FAILED"
            ? "bg-red-50 text-red-700"
            : "bg-emerald-50 text-emerald-800")
      }
    >
      {label}
    </span>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-slate-600">
      <span className="mb-2 block">{label}</span>
      {children}
    </label>
  );
}
export function InfoForm({
  value,
  onChange,
}: {
  value: ClassInfo;
  onChange: (v: ClassInfo) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Object.keys(emptyInfo()).map((key) => (
        <Field key={key} label={key.replaceAll("_", " ")}>
          <Input
            value={value[key as keyof ClassInfo]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </Field>
      ))}
    </div>
  );
}
export function ConfigForm({
  value,
  onChange,
}: {
  value: Config;
  onChange: (v: Config) => void;
}) {
  const errors = validateConfig(value);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(value.weights).map(([k, v]) => (
          <Field key={k} label={k.toUpperCase() + " component weight (%)"}>
            <Input
              type="number"
              min="0"
              max="100"
              value={v}
              onChange={(e) =>
                onChange({
                  ...value,
                  weights: { ...value.weights, [k]: Number(e.target.value) },
                })
              }
            />
          </Field>
        ))}
        {Object.entries(value.subweights).map(([k, v]) => (
          <Field key={k} label={k + " internal weight (%)"}>
            <Input
              type="number"
              value={v}
              min="0"
              max="100"
              onChange={(e) =>
                onChange({
                  ...value,
                  subweights: {
                    ...value.subweights,
                    [k]: Number(e.target.value),
                  },
                })
              }
            />
          </Field>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {(
          ["units_per_term", "units_per_year", "passing_threshold"] as const
        ).map((k) => (
          <Field key={k} label={k.replaceAll("_", " ")}>
            <Input
              type="number"
              value={value[k]}
              onChange={(e) =>
                onChange({ ...value, [k]: Number(e.target.value) })
              }
            />
          </Field>
        ))}
      </div>
      <div className="flex gap-5">
        {[1, 2, 3].map((t) => (
          <label className="flex items-center gap-2 text-sm" key={t}>
            <input
              type="checkbox"
              checked={value.applicable_terms.includes(t)}
              onChange={(e) =>
                onChange({
                  ...value,
                  applicable_terms: e.target.checked
                    ? [...value.applicable_terms, t].sort()
                    : value.applicable_terms.filter((v) => v !== t),
                })
              }
            />
            Term {t}
          </label>
        ))}
      </div>
      <div className="rounded-lg bg-slate-50 p-4 text-sm">
        <p>
          Rules: SALAZAR stage rounding, examination subweights,
          maximum-boundary ceiling lookup, unit-based final grade. Blank inputs
          remain blank.
        </p>
        <Field label="Configuration review note">
          <Input
            className="mt-2"
            value={value.confirmation ?? ""}
            placeholder="Describe any resolved workbook differences"
            onChange={(e) =>
              onChange({ ...value, confirmation: e.target.value })
            }
          />
        </Field>
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={value.resolved}
            onChange={(e) => onChange({ ...value, resolved: e.target.checked })}
          />
          I have resolved the grading configuration. Otherwise grades remain
          provisional.
        </label>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Transmutation and descriptors · {value.ranges.length} rows
        </summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Minimum (reference)</th>
                <th>Maximum (lookup)</th>
                <th>Grade</th>
                <th>Descriptor</th>
              </tr>
            </thead>
            <tbody>
              {value.ranges.map((r, i) => (
                <tr key={i}>
                  <td>
                    <Input
                      aria-label={"Minimum " + i}
                      type="number"
                      step="any"
                      value={r.lower}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          ranges: value.ranges.map((v, j) =>
                            j === i
                              ? { ...v, lower: Number(e.target.value) }
                              : v,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <Input
                      aria-label={"Maximum " + i}
                      type="number"
                      step="any"
                      value={r.upper}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          ranges: value.ranges.map((v, j) =>
                            j === i
                              ? { ...v, upper: Number(e.target.value) }
                              : v,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>{r.grade}</td>
                  <td>
                    <Input
                      aria-label={"Descriptor " + r.grade}
                      value={
                        value.descriptors.find((d) => d.grade === r.grade)
                          ?.label ?? ""
                      }
                      onChange={(e) =>
                        onChange({
                          ...value,
                          descriptors: value.descriptors.map((d) =>
                            d.grade === r.grade
                              ? { ...d, label: e.target.value }
                              : d,
                          ),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {errors.length > 0 && <ErrorBox error={errors.join(" ")} />}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="empty-state p-8 sm:p-12 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-md bg-stone-100 text-3xl text-primary">
        ▤
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mx-auto mb-5 mt-2 max-w-md text-sm text-slate-500">
        {description}
      </p>
      {action}
    </Card>
  );
}
export { Card, Input, Button };
