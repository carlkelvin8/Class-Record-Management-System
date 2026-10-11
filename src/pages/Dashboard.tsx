import { useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  Users,
  TrendingUp,
  ClipboardList,
  AlertCircle,
  Upload,
  ArrowUpRight,
  ArrowRight,
  BookOpen,
  Check,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { useClasses, getBundle } from "../lib/api";
import {
  Card,
  Button,
  Loading,
  ErrorBox,
  EmptyState,
} from "../components/common";
const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (notify: () => void) => {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const avg = (n: number[]) =>
  n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(1));
export function Dashboard() {
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(motionQuery).matches,
    () => true,
  );
  const classes = useClasses(),
    [selected, setSelected] = useState("all");
  const queries = useQueries({
    queries: (classes.data ?? [])
      .filter((c) => !c.archived && (selected === "all" || c.id === selected))
      .map((c) => ({
        queryKey: ["class", c.id],
        queryFn: () => getBundle(c.id),
      })),
  });
  const bundles = queries.flatMap((q) => (q.data ? [q.data] : []));
  const m = useMemo(() => {
    const term = bundles.flatMap((b) =>
      b.termGrades
        .filter(
          (g) =>
            !g.result.incomplete &&
            !g.result.provisional &&
            g.result.grade !== null,
        )
        .map((g) => g.result.grade!),
    );
    const finals = bundles.flatMap((b) =>
      b.finalGrades
        .filter(
          (g) =>
            !g.result.incomplete &&
            !g.result.provisional &&
            g.result.final !== null,
        )
        .map((g) => g.result.final!),
    );
    const bins = [
      { label: "60–64", lo: 60, hi: 64 },
      { label: "65–74", lo: 65, hi: 74 },
      { label: "75–79", lo: 75, hi: 79 },
      { label: "80–89", lo: 80, hi: 89 },
      { label: "90–100", lo: 90, hi: 100 },
    ].map((r) => ({
      ...r,
      count: term.filter((g) => g >= r.lo && g <= r.hi).length,
    }));
    const incomplete = bundles.flatMap((b) =>
      b.learners
        .filter(
          (l) =>
            b.termGrades.some(
              (g) =>
                g.enrollment_id === l.id &&
                (g.result.incomplete || g.result.provisional),
            ) ||
            b.finalGrades.some(
              (g) =>
                g.enrollment_id === l.id &&
                (g.result.incomplete || g.result.provisional),
            ),
        )
        .map((l) => ({ name: l.name, section: b.info.section, id: b.info.id })),
    );
    const below = bundles.flatMap((b) =>
      b.learners
        .filter((l) =>
          b.termGrades.some(
            (g) =>
              g.enrollment_id === l.id &&
              !g.result.incomplete &&
              !g.result.provisional &&
              g.result.grade !== null &&
              g.result.grade < b.config.passing_threshold,
          ),
        )
        .map((l) => ({ name: l.name, section: b.info.section, id: b.info.id })),
    );
    const assessment = bundles.flatMap((b) =>
      b.assessments.map((a) => {
        const scores = b.scores.filter(
          (s) => s.assessment_id === a.id && s.value !== null,
        );
        return {
          name: b.info.section + " · " + a.name,
          average: avg(scores.map((s) => (s.value! / a.maximum) * 100)),
          entered: scores.length,
        };
      }),
    );
    return {
      students: bundles.reduce((s, b) => s + b.learners.length, 0),
      term: avg(term),
      final: avg(finals),
      bins,
      incomplete,
      below,
      assessment,
    };
  }, [bundles]);
  const error = classes.error || queries.find((q) => q.error)?.error;
  const complete = Math.max(0, m.students - m.incomplete.length);
  const completion = m.students ? Math.round((complete / m.students) * 100) : 0;
  const date = new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
  const pending = classes.isLoading || queries.some((q) => q.isLoading);
  return (
    <div className="desk-dashboard">
      <div className="desk-topline">
        <span>
          <span className="desk-live-dot" /> THE TEACHER'S DESK
        </span>
        <time>{date}</time>
      </div>
      <section className="desk-hero">
        <div className="desk-hero-copy">
          <span className="desk-eyebrow">A CLEARER PICTURE OF EVERY CLASS</span>
          <h1>
            Your classes,
            <br />
            <em>in perspective.</em>
          </h1>
          <p>
            Less time finding the numbers. More time
            <br className="hidden sm:block" /> helping your learners move
            forward.
          </p>
          <div className="desk-hero-actions">
            <Button asChild>
              <Link to="/import">
                <Upload size={16} /> Import workbook
              </Link>
            </Button>
            <Link className="desk-text-link" to="/classes">
              Open my classes <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <div className="desk-book-art" aria-hidden="true">
          <div className="desk-book-back" />
          <div className="desk-book">
            <div className="desk-book-label">
              CLASSROOM <span>RECORD No. 01</span>
            </div>
            <div className="desk-book-title">
              Every learner.
              <br />
              Every little step.
            </div>
            <div className="desk-book-rule" />
            <div className="desk-book-lines">
              {[0, 1, 2, 3].map((n) => (
                <div key={n}>
                  <span />
                  <i />
                  <i />
                  <i />
                </div>
              ))}
            </div>
            <div className="desk-book-bottom">
              THE CLASS RECORD COLLECTION <BookOpen size={22} />
            </div>
          </div>
          <span className="desk-book-tab">a work in progress</span>
        </div>
      </section>
      <div className="desk-section-head">
        <div>
          <h2>At a glance</h2>
          <p>A snapshot of your active class records.</p>
        </div>
        <label className="desk-filter">
          <span>Showing</span>
          <select
            aria-label="Filter dashboard by class"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="all">All active classes</option>
            {classes.data
              ?.filter((c) => !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.section} · {c.subject}
                </option>
              ))}
          </select>
        </label>
      </div>
      <ErrorBox error={error} />
      {pending ? (
        <Loading />
      ) : !bundles.length ? (
        <EmptyState
          title="Your teaching workspace is ready"
          description="Import a workbook to bring your classes, learners, and grades together."
          action={
            <Button asChild>
              <Link to="/import">
                Import your first workbook <ArrowRight size={16} />
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="desk-metrics">
            {[
              {
                label: "Enrolled learners",
                value: m.students,
                detail: `${bundles.length} active classes`,
                Icon: Users,
              },
              {
                label: "Average term grade",
                value: fmt(m.term),
                detail: "Complete term results",
                Icon: TrendingUp,
              },
              {
                label: "Average final grade",
                value: fmt(m.final),
                detail: "Complete final results",
                Icon: ClipboardList,
              },
              {
                label: "Records to review",
                value: m.incomplete.length,
                detail: "Incomplete or provisional",
                Icon: AlertCircle,
              },
            ].map(({ label, value, detail, Icon }, i) => (
              <Card
                key={label}
                className={"desk-metric metric-" + i}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="desk-metric-label">
                  {label}
                  <Icon size={17} />
                </div>
                <div className="desk-metric-value">
                  {value}
                  <span>{i === 1 || i === 2 ? "/ 100" : ""}</span>
                </div>
                <p>{detail}</p>
              </Card>
            ))}
          </div>
          <div className="desk-section-head desk-class-heading">
            <div>
              <h2>Your class shelf</h2>
              <p>Pick up where you left off.</p>
            </div>
            <Link className="desk-inline-link" to="/classes">
              All classes <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="desk-class-shelf">
            {bundles.map((b, i) => (
              <Link
                key={b.info.id}
                to={"/classes/" + b.info.id}
                className={"desk-class-tile shelf-" + (i % 3)}
              >
                <div className="desk-class-tile-top">
                  <span>GRADE {b.info.grade_level}</span>
                  <ArrowUpRight size={18} />
                </div>
                <h3>{b.info.section}</h3>
                <p>{b.info.subject}</p>
                <div className="desk-class-tile-foot">
                  <span>
                    <Users size={13} />
                    {b.learners.length} learners
                  </span>
                  <span>
                    Open record <ArrowRight size={13} />
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <div className="desk-insights">
            <Card className="desk-chart-panel">
              <div className="desk-panel-heading">
                <div>
                  <span className="desk-eyebrow">LEARNING PROGRESS</span>
                  <h2>Where the grades stand</h2>
                </div>
                <span className="desk-chart-legend">
                  <i /> Term results
                </span>
              </div>
              <p className="desk-panel-subtitle">
                Complete term grades, grouped by grade range.
              </p>
              <div className="desk-grade-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={m.bins}
                    margin={{ top: 20, left: -20, right: 8, bottom: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="#eaece7"
                      strokeDasharray="3 5"
                    />
                    <XAxis
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#747c73", fontSize: 11 }}
                      dy={10}
                    />
                    <YAxis
                      allowDecimals={false}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "#91988e", fontSize: 10 }}
                    />
                    <Tooltip
                      cursor={{ fill: "#f1f3ed" }}
                      contentStyle={{
                        borderRadius: 10,
                        borderColor: "#dde3d9",
                        fontSize: 12,
                      }}
                    />
                    <Bar
                      dataKey="count"
                      name="Term results"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={60}
                      isAnimationActive={!reducedMotion}
                      animationDuration={650}
                    >
                      {m.bins.map((bin, i) => (
                        <Cell
                          key={bin.label}
                          fill={
                            [
                              "#d6c0a4",
                              "#c2c7a5",
                              "#92a58b",
                              "#5d806a",
                              "#294f3d",
                            ][i]
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="desk-chart-note">
                <span>
                  {m.bins.reduce((n, b) => n + b.count, 0)} complete term
                  results
                </span>
                <span>Incomplete results excluded</span>
              </div>
            </Card>
            <Card className="desk-completion-panel">
              <span className="desk-eyebrow">THE BIG PICTURE</span>
              <h2>Record readiness</h2>
              <div
                className="desk-ring"
                style={{
                  background: `conic-gradient(#294f3d ${completion * 3.6}deg, #e7ecdf 0deg)`,
                }}
              >
                <div>
                  <strong>{completion}%</strong>
                  <span>complete</span>
                </div>
              </div>
              <div className="desk-readiness-row">
                <span>
                  <i className="ready-dot" />
                  Complete records
                </span>
                <strong>{complete}</strong>
              </div>
              <div className="desk-readiness-row">
                <span>
                  <i className="review-dot" />
                  Need review
                </span>
                <strong>{m.incomplete.length}</strong>
              </div>
              <p className="desk-readiness-note">
                A record is ready when all applicable grades are complete and
                resolved.
              </p>
            </Card>
            <Card className="desk-assessment-panel">
              <div className="desk-panel-heading">
                <div>
                  <span className="desk-eyebrow">ASSESSMENT SNAPSHOT</span>
                  <h2>The work behind the grades</h2>
                </div>
                <span className="desk-count-chip">
                  {m.assessment.length} assessments
                </span>
              </div>
              <p className="desk-panel-subtitle">
                Average entered score as a percentage of the maximum.
              </p>
              <div className="desk-assessment-list">
                {m.assessment.map((a, i) => (
                  <div className="desk-assessment-row" key={i}>
                    <div>
                      <span>{a.name}</span>
                      <small>{a.entered} entered scores</small>
                    </div>
                    <div className="desk-progress-track">
                      <span style={{ width: `${a.average ?? 0}%` }} />
                    </div>
                    <strong>
                      {a.average === null ? "—" : fmt(a.average) + "%"}
                    </strong>
                  </div>
                ))}
              </div>
              <p className="desk-chart-note">
                Blank scores are excluded ·{" "}
                {m.assessment.filter((a) => a.entered === 0).length} assessments
                awaiting scores
              </p>
            </Card>
            <Card className="desk-review-panel">
              <div className="desk-panel-heading">
                <div>
                  <span className="desk-eyebrow">NEXT UP</span>
                  <h2>A little attention</h2>
                </div>
                <AlertCircle size={20} />
              </div>
              <div className="desk-review-total">
                <strong>{m.below.length}</strong>
                <p>
                  learners below the
                  <br />
                  passing threshold
                </p>
              </div>
              <div className="desk-review-list">
                {m.below.length ? (
                  m.below.map((l, i) => (
                    <Link key={i} to={"/classes/" + l.id}>
                      <span>
                        {l.name}
                        <small>{l.section}</small>
                      </span>
                      <ArrowUpRight size={15} />
                    </Link>
                  ))
                ) : (
                  <div className="desk-review-clear">
                    <Check size={18} />
                    No complete term grades below the passing threshold.
                  </div>
                )}
              </div>
              <div className="desk-review-footer">
                <span>Review incomplete records</span>
                <strong>{m.incomplete.length}</strong>
              </div>
              <div className="desk-review-list compact">
                {m.incomplete.slice(0, 5).map((l, i) => (
                  <Link key={i} to={"/classes/" + l.id}>
                    <span>
                      {l.name}
                      <small>{l.section}</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </Link>
                ))}
              </div>
              <Link to="/classes" className="desk-inline-link">
                Go to class records <ArrowRight size={15} />
              </Link>
            </Card>
          </div>
          <div className="desk-bottom-note">
            <BookOpen size={16} />
            <span>Every number is a starting point for a conversation.</span>
            <span>Classroom / Your teaching companion</span>
          </div>
        </>
      )}
    </div>
  );
}
