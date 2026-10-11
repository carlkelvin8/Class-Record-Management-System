import { useEffect, useState, useRef, lazy, Suspense } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  NavLink,
  Outlet,
  useNavigate,
  useLocation,
} from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  GraduationCap,
  Upload,
  History,
  BookOpen,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { configured, supabase } from "./lib/supabase";
import { Button, Input, ErrorBox, Loading } from "./components/common";
import { WorkspaceArt } from "./components/WorkspaceArt";
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Classes = lazy(() =>
  import("./pages/Classes").then((m) => ({ default: m.Classes })),
);
const ImportPage = lazy(() =>
  import("./pages/ImportPage").then((m) => ({ default: m.ImportPage })),
);
const ClassRecord = lazy(() =>
  import("./pages/ClassRecord").then((m) => ({ default: m.ClassRecord })),
);
const FinalGrades = lazy(() =>
  import("./pages/ClassRecord").then((m) => ({ default: m.FinalGrades })),
);
const Configuration = lazy(() =>
  import("./pages/ClassRecord").then((m) => ({ default: m.Configuration })),
);
const ImportHistory = lazy(() =>
  import("./pages/ImportHistory").then((m) => ({ default: m.ImportHistory })),
);
function Auth() {
  const [register, setRegister] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="auth-brand">
          <span className="brand-mark">
            <BookOpen size={23} />
          </span>
          classroom<span className="brand-dot">.</span>
        </div>
        <div className="auth-story-content">
          <div className="section-label">
            CLASS RECORD MANAGEMENT <span>01 /</span>
          </div>
          <h1>
            Class records,
            <br />
            kept in order.
          </h1>
          <p>
            Bring in your workbook. Keep track of scores.
            <br />
            See where every learner stands.
          </p>
          <WorkspaceArt />
        </div>
        <div className="auth-story-footer">
          <span>
            <b>01</b> Import workbooks
          </span>
          <span>
            <b>02</b> Update scores
          </span>
          <span>
            <b>03</b> Review grades
          </span>
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-top-note">
          <span>Teacher access</span>
          <span>CLASSROOM /</span>
        </div>
        <div className="auth-form-wrap">
          <div className="section-label">
            {register ? "NEW ACCOUNT" : "SIGN IN"}
          </div>
          <h2>{register ? "Create an account" : "Welcome back."}</h2>
          <p className="auth-intro">
            {register
              ? "Set up your teacher account to start keeping class records."
              : "Sign in to manage your classes and records."}
          </p>
          {!configured && (
            <div className="setup-notice">
              Account access is unavailable until workspace setup is complete.
            </div>
          )}
          <form
            className="auth-form space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const r = register
                  ? await supabase.auth.signUp({
                      email,
                      password,
                      options: { data: { display_name: name } },
                    })
                  : await supabase.auth.signInWithPassword({ email, password });
                if (r.error) throw r.error;
                if (register && !r.data.session)
                  setMessage("Check your email to confirm your account.");
              } catch (e) {
                setError(e instanceof Error ? e.message : "Unable to sign in");
              } finally {
                setBusy(false);
              }
            }}
          >
            {register && (
              <label className="block text-sm">
                Teacher name
                <Input
                  required
                  className="mt-2"
                  value={name}
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label className="block text-sm">
              Email
              <Input
                required
                type="email"
                autoComplete="email"
                className="mt-2"
                placeholder="you@school.edu"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Password
              <Input
                required
                type="password"
                minLength={8}
                autoComplete={register ? "new-password" : "current-password"}
                className="mt-2"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <ErrorBox error={error} />
            {message && <p role="status">{message}</p>}
            <Button
              disabled={busy || !configured}
              className="auth-submit w-full"
            >
              {busy ? "Connecting…" : register ? "Create account" : "Sign in"}
              <ChevronRight size={16} />
            </Button>
          </form>
          <p className="mt-7 text-center text-sm text-slate-500">
            {register ? "Already have an account?" : "New to Classroom?"}{" "}
            <button
              className="font-medium text-primary"
              onClick={() => {
                setRegister(!register);
                setError("");
                setMessage("");
              }}
            >
              {register ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
        <div className="auth-bottom-note">
          <span>Classroom</span>
          <span>Class Record Management System</span>
        </div>
      </section>
    </div>
  );
}
function Shell({ session }: { session: Session }) {
  const nav = useNavigate(),
    loc = useLocation(),
    qc = useQueryClient();
  const name =
    session.user.user_metadata.display_name ||
    session.user.email?.split("@")[0] ||
    "Teacher";
  return (
    <div className="min-h-screen">
      <aside className="workspace-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 flex-col lg:flex">
        <NavLink
          to="/"
          className="sidebar-brand flex items-center gap-3 px-7 py-8 text-xl font-semibold"
        >
          <span className="brand-mark">
            <BookOpen size={22} />
          </span>
          Classroom
        </NavLink>
        <div className="px-7 pb-4 pt-5 text-[10px] font-semibold tracking-[.18em] text-slate-400">
          TEACHER WORKSPACE
        </div>
        <nav className="sidebar-nav space-y-1 px-4">
          {[
            ["/", LayoutDashboard, "Dashboard"],
            ["/classes", GraduationCap, "My classes"],
            ["/import", Upload, "Import workbook"],
            ["/history", History, "Import history"],
          ].map(([href, Icon, label]) => {
            const I = Icon as typeof BookOpen;
            return (
              <NavLink
                key={String(href)}
                end={href === "/"}
                to={String(href)}
                className={({ isActive }) =>
                  "flex items-center gap-3 rounded-lg px-4 py-3 text-sm " +
                  (isActive ? "nav-active font-semibold" : "nav-idle")
                }
              >
                <I size={18} />
                {String(label)}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-import mt-auto m-5 rounded-xl p-4">
          <p className="text-sm font-semibold">Have an existing workbook?</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Import a workbook and review every change before saving.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 p-0 text-primary"
            onClick={() => nav("/import")}
          >
            Start an import →
          </Button>
        </div>
        <button
          className="sidebar-signout flex items-center gap-3 border-t px-7 py-5 text-sm"
          onClick={async () => {
            await supabase.auth.signOut();
            qc.clear();
          }}
        >
          <LogOut size={17} />
          Sign out
        </button>
      </aside>
      <div className="lg:ml-60">
        <header className="workspace-header flex h-20 items-center justify-between border-b border-border px-6 lg:px-10">
          <div className="text-sm text-slate-400">
            Workspace <span className="mx-3">/</span>
            <span className="capitalize text-slate-700">
              {loc.pathname.split("/")[1] || "Dashboard"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{name}</p>
              <p className="text-xs text-slate-400">Teacher account</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EEEAE3] text-sm font-semibold text-primary">
              {String(name).slice(0, 2).toUpperCase()}
            </span>
            <button
              className="lg:hidden"
              aria-label="Sign out"
              onClick={async () => {
                await supabase.auth.signOut();
                qc.clear();
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <nav className="mobile-nav flex gap-2 overflow-auto border-b bg-white p-3 text-sm lg:hidden">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/classes">Classes</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/history">History</NavLink>
        </nav>
        <main className="workspace-main mx-auto max-w-[1600px] p-5 sm:p-6 lg:p-10">
          <div className="page-enter" key={loc.pathname}>
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
        <footer className="px-10 pb-5 text-xs text-slate-400">
          Classroom · Workbook-based class records
        </footer>
      </div>
    </div>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [authError, setAuthError] = useState("");
  const qc = useQueryClient();
  const userId = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    const updateSession = (next: Session | null) => {
      if (!active) return;
      const nextId = next?.user.id ?? null;
      if (userId.current !== nextId) qc.clear();
      userId.current = nextId;
      setSession(next);
      setLoading(false);
    };
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        updateSession(data.session);
      })
      .catch((error: unknown) => {
        if (active) {
          setAuthError(
            error instanceof Error
              ? error.message
              : "Unable to restore your session.",
          );
          setLoading(false);
        }
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => updateSession(next));
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [qc]);
  if (loading) return <Loading />;
  if (authError)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox error={authError} />
        <Button onClick={() => window.location.reload()}>
          Retry connection
        </Button>
      </div>
    );
  return (
    <BrowserRouter>
      {!session ? (
        <Auth />
      ) : (
        <Routes>
          <Route element={<Shell session={session} />}>
            <Route index element={<Dashboard />} />
            <Route path="classes" element={<Classes />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="history" element={<ImportHistory />} />
            <Route path="classes/:id" element={<ClassRecord />} />
            <Route path="classes/:id/final" element={<FinalGrades />} />
            <Route
              path="classes/:id/configuration"
              element={<Configuration />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </BrowserRouter>
  );
}
