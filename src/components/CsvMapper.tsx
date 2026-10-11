import { useState } from "react";
import type { CsvMapping } from "../lib/importer";
import { Card, Field, Input, Button, ErrorBox } from "./common";
import type { Category, Sub } from "../lib/types";
export function CsvMapper({
  headers,
  onMapped,
}: {
  headers: string[];
  onMapped: (m: CsvMapping) => void;
}) {
  const [m, setM] = useState<CsvMapping>({
      name: "",
      lrn: "",
      sex: "",
      assessments: [],
    }),
    [error, setError] = useState("");
  const options = (
    <>
      <option value="">Not mapped</option>
      {headers.map((h) => (
        <option key={h}>{h}</option>
      ))}
    </>
  );
  return (
    <Card className="space-y-5 p-6">
      <h2 className="font-semibold">Map CSV columns</h2>
      <p className="text-sm text-slate-500">
        CSV has no workbook sheets, formulas, maxima, or grading tables. Map
        identity columns and define each score column. All fields are parsed as
        strings, including LRNs.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {(["name", "lrn", "sex"] as const).map((k) => (
          <Field key={k} label={k}>
            <select
              className="w-full"
              value={m[k]}
              onChange={(e) => setM({ ...m, [k]: e.target.value })}
            >
              {options}
            </select>
          </Field>
        ))}
      </div>
      <h3 className="text-sm font-medium">Score columns</h3>
      {m.assessments.map((a, i) => (
        <div key={i} className="grid gap-2 md:grid-cols-6">
          <select
            aria-label="Score column"
            value={a.column}
            onChange={(e) =>
              setM({
                ...m,
                assessments: m.assessments.map((v, j) =>
                  j === i ? { ...v, column: e.target.value } : v,
                ),
              })
            }
          >
            {options}
          </select>
          <select
            aria-label="Component"
            value={a.category}
            onChange={(e) =>
              setM({
                ...m,
                assessments: m.assessments.map((v, j) =>
                  j === i
                    ? {
                        ...v,
                        category: e.target.value as Category,
                        subcomponent: e.target.value === "ex" ? "ST1" : null,
                      }
                    : v,
                ),
              })
            }
          >
            <option value="ww">Written / Oral</option>
            <option value="pt">Performance</option>
            <option value="ex">Examination</option>
          </select>
          <Input
            aria-label="Maximum score"
            type="number"
            min="0.01"
            step="any"
            value={a.maximum}
            onChange={(e) =>
              setM({
                ...m,
                assessments: m.assessments.map((v, j) =>
                  j === i ? { ...v, maximum: Number(e.target.value) } : v,
                ),
              })
            }
          />
          <select
            aria-label="Applicable term"
            value={a.term}
            onChange={(e) =>
              setM({
                ...m,
                assessments: m.assessments.map((v, j) =>
                  j === i ? { ...v, term: Number(e.target.value) } : v,
                ),
              })
            }
          >
            {[1, 2, 3].map((t) => (
              <option value={t} key={t}>
                Term {t}
              </option>
            ))}
          </select>
          {a.category === "ex" ? (
            <select
              aria-label="Examination"
              value={a.subcomponent ?? "ST1"}
              onChange={(e) =>
                setM({
                  ...m,
                  assessments: m.assessments.map((v, j) =>
                    j === i ? { ...v, subcomponent: e.target.value as Sub } : v,
                  ),
                })
              }
            >
              <option>ST1</option>
              <option>ST2</option>
              <option>TE</option>
            </select>
          ) : (
            <span />
          )}
          <Button
            variant="ghost"
            onClick={() =>
              setM({
                ...m,
                assessments: m.assessments.filter((_, j) => i !== j),
              })
            }
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        onClick={() =>
          setM({
            ...m,
            assessments: [
              ...m.assessments,
              {
                column: "",
                category: "ww",
                subcomponent: null,
                maximum: 10,
                term: 1,
              },
            ],
          })
        }
      >
        Add score column
      </Button>
      <ErrorBox error={error} />
      <div>
        <Button
          onClick={() => {
            if (
              !m.name ||
              m.assessments.some((a) => !a.column) ||
              new Set([
                m.name,
                ...(m.lrn ? [m.lrn] : []),
                ...(m.sex ? [m.sex] : []),
                ...m.assessments.map((a) => a.column),
              ]).size !==
                1 + (m.lrn ? 1 : 0) + (m.sex ? 1 : 0) + m.assessments.length
            ) {
              setError("Map a name column and unique score/identity columns.");
              return;
            }
            onMapped(m);
          }}
        >
          Review mapped data
        </Button>
      </div>
    </Card>
  );
}
