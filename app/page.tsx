"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";
import { useTheme, ThemeId } from "./components/ThemeProvider";

/** ---------- Helpers ---------- */
function money(n: number) {
  const x = Number(n ?? 0);
  return (Math.round(x * 100) / 100).toFixed(2);
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function dowName(dow: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow] ?? "Day";
}

/** ---------- bucket_collections row ---------- */
type BucketCollectionRow = {
  id: string;
  user_id: string;
  week_start: string; // YYYY-MM-DD
  bucket: string; // "save" | "emergency" | "student loans" | etc
  amount: number;
  created_at?: string;
};

type UserPreferences = {
  user_id: string;
  week_start_dow: number; // 0..6
  notice_dow: number | null;
  updated_at: string;
};

type TrackerBucket = "savings" | "student_loans" | "emergency" | "extra_money";

/** IMPORTANT: supports notes in bucket label like "student loans (gift)" */
function trackerForRawBucket(raw: string): TrackerBucket {
  const x = (raw ?? "").toLowerCase().trim();
  if (x.startsWith("save")) return "savings";
  if (x.startsWith("student loans")) return "student_loans";
  if (x.startsWith("emergency")) return "emergency";
  return "extra_money";
}

/**
 * ThemeProvider should define these vars on :root or a wrapper:
 * --bg, --card, --border, --text, --muted, --shadow, --shadowSoft
 * plus accents: --pink, --pinkSoft, --lavender, --lavenderSoft, --mintSoft, --peachSoft
 * optional: --ringTrack
 */
const css = {
  bg: "var(--bg)",
  card: "var(--card)",
  border: "var(--border)",
  text: "var(--text)",
  muted: "var(--muted)",
  shadow: "var(--shadow)",
  shadowSoft: "var(--shadowSoft)",

  pink: "var(--pink)",
  pinkSoft: "var(--pinkSoft)",
  lavender: "var(--lavender)",
  lavenderSoft: "var(--lavenderSoft)",
  mintSoft: "var(--mintSoft)",
  peachSoft: "var(--peachSoft)",
};

const cardStyle: React.CSSProperties = {
  border: `1px solid ${css.border}`,
  borderRadius: 18,
  padding: "1rem",
  background: css.card,
  color: css.text,
  boxShadow: css.shadow,
};

const btnBase: React.CSSProperties = {
  borderRadius: 14,
  padding: "0.55rem 0.9rem",
  cursor: "pointer",
  fontWeight: 900,
  border: `1px solid ${css.border}`,
  background: css.card,
  color: css.text,
  boxShadow: css.shadowSoft,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const btnSoft: React.CSSProperties = {
  ...btnBase,
  background: `linear-gradient(135deg, ${css.pinkSoft} 0%, ${css.lavenderSoft} 100%)`,
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  border: "1px solid var(--borderStrong, rgba(0,0,0,0.12))",
  background: `linear-gradient(135deg, var(--accent) 0%, var(--accent2, var(--accent)) 100%)`,
  color: "var(--onPrimary, #fff)",          // ✅ text always visible
  boxShadow: "var(--shadowStrong, var(--shadowSoft))",
};


const inputStyle: React.CSSProperties = {
  display: "block",
  padding: "0.55rem 0.7rem",
  minWidth: 180,
  background: css.card,
  color: css.text,
  border: `1px solid ${css.border}`,
  borderRadius: 14,
  outline: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
};

const selectStyle: React.CSSProperties = { ...inputStyle };

/** Grad strip per bucket (uses vars so theme swap updates instantly) */
function strip(key: TrackerBucket) {
  switch (key) {
    case "savings":
      return `linear-gradient(90deg, ${css.pinkSoft}, ${css.lavenderSoft})`;
    case "student_loans":
      return `linear-gradient(90deg, ${css.lavenderSoft}, ${css.pinkSoft})`;
    case "emergency":
      return `linear-gradient(90deg, ${css.mintSoft}, ${css.lavenderSoft})`;
    case "extra_money":
    default:
      return `linear-gradient(90deg, ${css.peachSoft}, ${css.mintSoft})`;
  }
}

/**
 * IMPORTANT: conic-gradient breaks if ringColor is an undefined CSS var.
 * So we ALWAYS return var(--x, fallback) for theme colors.
 */
function ringColorFor(key: TrackerBucket) {
  switch (key) {
    case "savings":
      return "var(--pink, #FF6FB1)";
    case "student_loans":
      return "var(--lavender, #B7A7FF)";
    case "emergency":
      // try to use mintSoft; if you later add --mint, it will use that too
      return "var(--mint, var(--mintSoft, #56D6C9))";
    case "extra_money":
    default:
      return "var(--peach, var(--peachSoft, #FFB38A))";
  }
}

/** ---------- Goals (Supabase: user_goals) ---------- */
type UserGoalRow = {
  id: string;
  user_id: string;
  key: TrackerBucket;
  title: string;
  target: number;
  ring_color: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

function GoalDonutCard({
  title,
  accent,
  ringColor,
  current,
  target,
}: {
  title: string;
  accent: string;
  ringColor: string;
  current: number;
  target: number;
}) {
  const pct = target <= 0 ? 0 : clamp((current / target) * 100, 0, 100);
  const remaining = Math.max(target - current, 0);

  // track is also themeable, but must have a fallback
  const trackColor = "var(--ringTrack, rgba(0,0,0,0.08))";

  return (
    <div
      style={{
        ...cardStyle,
        boxShadow: "0 18px 40px rgba(255, 150, 200, 0.22)",
        background: `linear-gradient(135deg, ${css.card} 0%, ${css.pinkSoft} 100%)`,
      }}
    >
      <div style={{ height: 10, borderRadius: 999, background: accent, marginBottom: 12 }} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ minWidth: 240 }}>
          <div style={{ fontWeight: 950, fontSize: 16 }}>{title}</div>
          <div style={{ marginTop: 8, fontWeight: 950, fontSize: 26 }}>${money(current)}</div>
          <div style={{ marginTop: 4, color: css.muted, fontWeight: 750 }}>
            of ${money(target)} • <span style={{ color: css.text, fontWeight: 950 }}>${money(remaining)}</span> left
          </div>
        </div>

        <div
          style={{
            width: 98,
            height: 98,
            borderRadius: 999,
            // ✅ always valid now
            background: `conic-gradient(${ringColor} 0% ${pct}%, ${trackColor} ${pct}% 100%)`,
            position: "relative",
            boxShadow: "0 12px 24px rgba(0,0,0,0.07)",
            border: `1px solid ${css.border}`,
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 8,
              borderRadius: 999,
              background: css.card,
              border: `1px solid ${css.border}`,
            }}
          />
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
            <div style={{ fontWeight: 950, fontSize: 20 }}>{Math.round(pct)}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatPill({ title, value, stripBg }: { title: string; value: number; stripBg: string }) {
  return (
    <div
      style={{
        border: `1px solid ${css.border}`,
        background: `linear-gradient(135deg, ${css.card} 0%, ${css.mintSoft} 100%)`,
        borderRadius: 18,
        padding: 14,
        boxShadow: css.shadowSoft,
      }}
    >
      <div style={{ height: 8, borderRadius: 999, background: stripBg, marginBottom: 10 }} />
      <div style={{ fontWeight: 900, opacity: 0.8 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 950, marginTop: 8 }}>${money(value)}</div>
    </div>
  );
}

export default function Home() {
  const [email, setEmail] = useState<string | null>(null);

  // collections for progress
  const [rows, setRows] = useState<BucketCollectionRow[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pay schedule prefs (collapsible)
  const [prefs, setPrefs] = useState<{ paydayDow: number; noticeDow: number | null }>({ paydayDow: 5, noticeDow: 4 });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  // Goals config (editable)
  const [goals, setGoals] = useState<UserGoalRow[]>([]);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [savingGoals, setSavingGoals] = useState(false);

  // add-goal form
  const [newGoalKey, setNewGoalKey] = useState<TrackerBucket>("emergency");
  const [newGoalTitle, setNewGoalTitle] = useState("Emergency Goal");
  const [newGoalTarget, setNewGoalTarget] = useState("");
  const [newGoalRing, setNewGoalRing] = useState("#56D6C9");

  async function ensureSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    return data.session;
  }

  async function loadPreferencesReturn(uid: string): Promise<{ paydayDow: number; noticeDow: number | null }> {
    try {
      const { data, error } = await supabase.from("user_preferences").select("*").eq("user_id", uid).maybeSingle();
      if (error || !data) return { paydayDow: 5, noticeDow: 4 };
      const p = data as UserPreferences;
      return { paydayDow: p.week_start_dow, noticeDow: p.notice_dow };
    } catch {
      return { paydayDow: 5, noticeDow: 4 };
    }
  }

  async function savePreferences(next: { paydayDow: number; noticeDow: number | null }) {
    setSavingPrefs(true);
    setErrorMsg(null);

    const session = await ensureSession().catch((e) => {
      setErrorMsg(String(e?.message ?? e));
      return null;
    });
    if (!session) {
      setSavingPrefs(false);
      return;
    }

    const uid = session.user.id;
    const { error } = await supabase.from("user_preferences").upsert({
      user_id: uid,
      week_start_dow: next.paydayDow,
      notice_dow: next.noticeDow,
      updated_at: new Date().toISOString(),
    });

    if (error) setErrorMsg(error.message);
    setSavingPrefs(false);
  }

  async function loadCollections(uid: string) {
    setErrorMsg(null);
    setDataLoading(true);

    const { data, error } = await supabase
      .from("bucket_collections")
      .select("id, user_id, week_start, bucket, amount, created_at")
      .eq("user_id", uid)
      .order("week_start", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMsg(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as BucketCollectionRow[]);
    }

    setDataLoading(false);
  }

  async function loadGoals(uid: string) {
    const { data, error } = await supabase.from("user_goals").select("*").eq("user_id", uid).order("sort_order", { ascending: true });

    if (error) {
      setErrorMsg((prev) => prev ?? `Goals table error: ${error.message}`);
      setGoals([]);
      return;
    }
    setGoals((data ?? []) as UserGoalRow[]);
  }

  async function upsertGoal(uid: string, patch: Partial<UserGoalRow> & { key: TrackerBucket; title: string; target: number; ring_color: string }) {
    setSavingGoals(true);
    setErrorMsg(null);

    const { error } = await supabase.from("user_goals").upsert({
      user_id: uid,
      key: patch.key,
      title: patch.title,
      target: patch.target,
      ring_color: patch.ring_color,
      sort_order: patch.sort_order ?? 0,
      is_active: patch.is_active ?? true,
      updated_at: new Date().toISOString(),
    });

    if (error) setErrorMsg(error.message);
    await loadGoals(uid);
    setSavingGoals(false);
  }

  async function toggleGoal(uid: string, g: UserGoalRow) {
    setSavingGoals(true);
    setErrorMsg(null);
    const { error } = await supabase.from("user_goals").update({ is_active: !g.is_active, updated_at: new Date().toISOString() }).eq("id", g.id);
    if (error) setErrorMsg(error.message);
    await loadGoals(uid);
    setSavingGoals(false);
  }

  async function deleteGoal(uid: string, g: UserGoalRow) {
    if (g.key === "savings" || g.key === "student_loans") {
      setErrorMsg("You can’t delete the Savings or Student Loans goals. You can edit the amount though.");
      return;
    }
    setSavingGoals(true);
    setErrorMsg(null);
    const { error } = await supabase.from("user_goals").delete().eq("id", g.id);
    if (error) setErrorMsg(error.message);
    await loadGoals(uid);
    setSavingGoals(false);
  }

  async function init() {
    setErrorMsg(null);
    setDataLoading(true);

    const session = await ensureSession().catch((e) => {
      setErrorMsg(String(e?.message ?? e));
      return null;
    });

    if (!session) {
      setEmail(null);
      setRows([]);
      setGoals([]);
      setDataLoading(false);
      return;
    }

    setEmail(session.user.email ?? null);

    const uid = session.user.id;
    const loadedPrefs = await loadPreferencesReturn(uid);
    setPrefs(loadedPrefs);

    await Promise.all([loadCollections(uid), loadGoals(uid)]);
  }

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const t: Record<TrackerBucket, number> = {
      savings: 0,
      student_loans: 0,
      emergency: 0,
      extra_money: 0,
    };
    for (const r of rows) {
      const k = trackerForRawBucket(r.bucket);
      t[k] += Number(r.amount ?? 0);
    }
    return t;
  }, [rows]);

  /** ---------- Default goals (do NOT change the look/labels/colors) ---------- */
  const defaultSavingsGoal = 500;
  const defaultLoansGoal = 2000;

  const goalByKey = useMemo(() => {
    const m = new Map<TrackerBucket, UserGoalRow>();
    for (const g of goals) m.set(g.key, g);
    return m;
  }, [goals]);

  const savingsTarget = Number(goalByKey.get("savings")?.target ?? defaultSavingsGoal);
  const loansTarget = Number(goalByKey.get("student_loans")?.target ?? defaultLoansGoal);

  const extraGoals = useMemo(() => {
    return goals
      .filter((g) => g.key !== "savings" && g.key !== "student_loans")
      .filter((g) => g.is_active)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [goals]);

  return (
    <main
      style={{
        width: "100%",
        maxWidth: "100%",
        background: `linear-gradient(180deg, ${css.bg} 0%, ${css.pinkSoft} 60%, ${css.bg} 100%)`,
        minHeight: "100vh",
        color: css.text,
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
        {/* Header */}
        <header style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 36, fontWeight: 950, letterSpacing: "-0.02em" }}>🏠 Home</h1>
              <div style={{ marginTop: 8, color: css.muted, fontWeight: 700 }}>Pay schedule first, then goals + totals.</div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <Link href="/dashboard" style={btnBase as any}>
                📊 Dashboard
              </Link>

              <Link href="/savings" style={btnBase as any}>
                💰 Savings
              </Link>

              <button
                onClick={async () => {
                  const session = await ensureSession().catch(() => null);
                  const uid = session?.user?.id;
                  if (!uid) return;
                  await Promise.all([loadCollections(uid), loadGoals(uid)]);
                }}
                style={btnBase}
              >
                🔄 Refresh
              </button>

              <ThemeDropdownSmall />
            </div>
          </div>
        </header>

        {errorMsg && (
          <div style={{ ...cardStyle, borderColor: "rgba(220,20,60,0.35)", marginBottom: "1rem" }}>
            <div style={{ fontWeight: 950, color: "crimson" }}>Home error:</div>
            <div style={{ marginTop: 6, color: css.muted, fontWeight: 750 }}>{errorMsg}</div>
          </div>
        )}

        {!email ? (
          <section style={cardStyle}>
            <div style={{ fontWeight: 900 }}>Sign in to view Home</div>
            <div style={{ marginTop: 6, color: css.muted, fontWeight: 700 }}>Your goal progress pulls from your bucket collections.</div>
          </section>
        ) : (
          <>
            {/* PAY SCHEDULE FIRST (collapsible) */}
            <section style={{ ...cardStyle, marginBottom: "1.25rem" }}>
              <div style={{ height: 10, borderRadius: 999, background: `linear-gradient(90deg, ${css.peachSoft}, ${css.pinkSoft})`, marginBottom: 12 }} />

              <button
                type="button"
                onClick={() => setPayOpen((v) => !v)}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                }}
                aria-expanded={payOpen}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950 }}>Pay schedule</h2>
                  <div style={{ marginTop: 6, color: css.muted, fontWeight: 700 }}>
                    Week starts on <span style={{ color: css.text, fontWeight: 950 }}>{dowName(prefs.paydayDow)}</span>
                    {prefs.noticeDow !== null ? (
                      <>
                        {" "}
                        • Notice: <span style={{ color: css.text, fontWeight: 950 }}>{dowName(prefs.noticeDow)}</span>
                      </>
                    ) : (
                      <>
                        {" "}
                        • Notice: <span style={{ color: css.text, fontWeight: 950 }}>None</span>
                      </>
                    )}
                  </div>
                </div>

                <span style={{ fontWeight: 950, color: css.muted }}>{payOpen ? "Hide ▲" : "Edit ▼"}</span>
              </button>

              {payOpen && (
                <div style={{ marginTop: 14, display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "end" }}>
                  <label style={{ fontWeight: 850 }}>
                    Week starts on (Payday)
                    <select
                      value={prefs.paydayDow}
                      onChange={async (e) => {
                        const next = { ...prefs, paydayDow: Number(e.target.value) };
                        setPrefs(next);
                        await savePreferences(next);
                      }}
                      style={{ ...selectStyle, minWidth: 220, marginTop: 6 }}
                    >
                      <option value={0}>Sunday</option>
                      <option value={1}>Monday</option>
                      <option value={2}>Tuesday</option>
                      <option value={3}>Wednesday</option>
                      <option value={4}>Thursday</option>
                      <option value={5}>Friday</option>
                      <option value={6}>Saturday</option>
                    </select>
                  </label>

                  <label style={{ fontWeight: 850 }}>
                    Notice day (optional)
                    <select
                      value={prefs.noticeDow ?? ""}
                      onChange={async (e) => {
                        const v = e.target.value === "" ? null : Number(e.target.value);
                        const next = { ...prefs, noticeDow: v };
                        setPrefs(next);
                        await savePreferences(next);
                      }}
                      style={{ ...selectStyle, minWidth: 220, marginTop: 6 }}
                    >
                      <option value="">None</option>
                      <option value={0}>Sunday</option>
                      <option value={1}>Monday</option>
                      <option value={2}>Tuesday</option>
                      <option value={3}>Wednesday</option>
                      <option value={4}>Thursday</option>
                      <option value={5}>Friday</option>
                      <option value={6}>Saturday</option>
                    </select>
                  </label>

                  <div style={{ fontSize: 14, color: css.muted, fontWeight: 700, maxWidth: 520 }}>
                    Rule: if you add income on{" "}
                    <span style={{ color: css.text, fontWeight: 950 }}>{prefs.noticeDow === null ? "the notice day (not set)" : dowName(prefs.noticeDow)}</span>, the
                    week starts on <span style={{ color: css.text, fontWeight: 950 }}>{dowName(prefs.paydayDow)}</span>.
                    {savingPrefs ? " Saving…" : ""}
                  </div>

                  <button type="button" style={btnSoft} onClick={() => setPayOpen(false)}>
                    Done
                  </button>
                </div>
              )}
            </section>

            {/* Goals header + edit button */}
            <section style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ marginBottom: "0.75rem", fontSize: 18, fontWeight: 950 }}>Goals</h2>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ color: css.muted, fontWeight: 750, fontSize: 13 }}>{dataLoading ? "Loading…" : `${rows.length} collection row(s)`}</div>

                  <button type="button" style={btnSoft} onClick={() => setGoalsOpen((v) => !v)}>
                    {goalsOpen ? "✖ Close goals" : "🎯 Edit goals"}
                  </button>
                </div>
              </div>

              {/* The two goals you want to keep exactly */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                <GoalDonutCard title="Savings Goal" accent={strip("savings")} ringColor={ringColorFor("savings")} current={totals.savings} target={savingsTarget} />
                <GoalDonutCard
                  title="Student Loans Savings"
                  accent={strip("student_loans")}
                  ringColor={ringColorFor("student_loans")}
                  current={totals.student_loans}
                  target={loansTarget}
                />
              </div>

              {/* Any extra goals you add */}
{extraGoals.length > 0 && (
  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
    {extraGoals.map((g) => (
      <GoalDonutCard
        key={g.id}
        title={g.title}
        accent={strip(g.key)}
        ringColor={g.ring_color?.trim() ? g.ring_color : ringColorFor(g.key)}
        current={totals[g.key]}
        target={Number(g.target ?? 0)}
      />
    ))}
  </div>
)}  {/* ✅ THIS must close BEFORE goalsOpen */}
{/* Collapsible goal editor */}
{goalsOpen && (
  <div style={{ ...cardStyle, marginTop: 12 }}>
    <div
      style={{
        height: 10,
        borderRadius: 999,
        background: `linear-gradient(90deg, ${css.pinkSoft}, ${css.lavenderSoft})`,
        marginBottom: 12,
      }}
    />

    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <div>
        <div style={{ fontWeight: 950, fontSize: 16 }}>Edit your goal targets</div>
        <div style={{ color: css.muted, fontWeight: 750, marginTop: 4 }}>
          These only change the target amount (your donut progress still comes from collections).
        </div>
      </div>

      <div style={{ color: css.muted, fontWeight: 750, fontSize: 13 }}>{savingGoals ? "Saving…" : ""}</div>
    </div>

    {/* Edit Savings + Loans targets */}
    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
      <GoalEditRow
        label="Savings Goal target"
        defaultTarget={defaultSavingsGoal}
        currentTarget={savingsTarget}
        onSave={async (newTarget) => {
          const session = await ensureSession().catch(() => null);
          const uid = session?.user?.id;
          if (!uid) return;

          await upsertGoal(uid, {
            key: "savings",
            title: "Savings Goal",
            target: newTarget,
            ring_color: "#FF6FB1",
            sort_order: 0,
            is_active: true,
          });
        }}
      />

      <GoalEditRow
        label="Student Loans Savings target"
        defaultTarget={defaultLoansGoal}
        currentTarget={loansTarget}
        onSave={async (newTarget) => {
          const session = await ensureSession().catch(() => null);
          const uid = session?.user?.id;
          if (!uid) return;

          await upsertGoal(uid, {
            key: "student_loans",
            title: "Student Loans Savings",
            target: newTarget,
            ring_color: "#B7A7FF",
            sort_order: 1,
            is_active: true,
          });
        }}
      />
    </div>

    {/* Add another goal */}
    <div style={{ marginTop: 16, borderTop: `1px solid ${css.border}`, paddingTop: 14 }}>
      <div style={{ fontWeight: 950, fontSize: 16 }}>Add another goal</div>
      <div style={{ color: css.muted, fontWeight: 750, marginTop: 4 }}>Example: Emergency fund goal, Extra money goal, etc.</div>

      <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ fontWeight: 850 }}>
          Bucket
          <select
            value={newGoalKey}
            onChange={(e) => {
              const k = e.target.value as TrackerBucket;
              setNewGoalKey(k);

              if (k === "emergency") setNewGoalTitle("Emergency Goal");
              else if (k === "extra_money") setNewGoalTitle("Extra Money Goal");
              else if (k === "savings") setNewGoalTitle("Savings Goal");
              else setNewGoalTitle("Student Loans Savings");
            }}
            style={{ ...selectStyle, minWidth: 220, marginTop: 6 }}
          >
            <option value="emergency">Emergency</option>
            <option value="extra_money">Extra Money</option>
            <option value="savings">Savings</option>
            <option value="student_loans">Student Loans</option>
          </select>
        </label>

        <label style={{ fontWeight: 850, minWidth: 260 }}>
          Title
          <input
            value={newGoalTitle}
            onChange={(e) => setNewGoalTitle(e.target.value)}
            style={{ ...inputStyle, width: "100%", marginTop: 6 }}
          />
        </label>

        <label style={{ fontWeight: 850 }}>
          Target
          <input
            inputMode="decimal"
            placeholder="1000"
            value={newGoalTarget}
            onChange={(e) => setNewGoalTarget(e.target.value)}
            style={{ ...inputStyle, minWidth: 180, marginTop: 6 }}
          />
        </label>

        <label style={{ fontWeight: 850 }}>
          Ring color
<input
  type="color"
  value={newGoalRing}
  onChange={(e) => setNewGoalRing(e.target.value)}
  style={{
    height: 42,
    padding: 4,
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: "var(--card)",
    cursor: "pointer",
  }}
/>
        </label>

        <button
          type="button"
          style={{ ...btnPrimary, opacity: savingGoals ? 0.7 : 1 }}
          disabled={savingGoals}
          onClick={async () => {
            setErrorMsg(null);

            const target = Number(newGoalTarget);
            if (!newGoalTitle.trim()) {
              setErrorMsg("Goal title is required.");
              return;
            }
            if (!newGoalTarget || Number.isNaN(target) || target <= 0) {
              setErrorMsg("Goal target must be a number greater than 0.");
              return;
            }

            const session = await ensureSession().catch(() => null);
            const uid = session?.user?.id;
            if (!uid) return;

            if (newGoalKey === "savings" || newGoalKey === "student_loans") {
              setErrorMsg("Use the edit rows above to change Savings or Student Loans targets.");
              return;
            }

            const existingCount = goals.filter((g) => g.key !== "savings" && g.key !== "student_loans").length;

            await upsertGoal(uid, {
              key: newGoalKey,
              title: newGoalTitle.trim(),
              target,
              ring_color: newGoalRing.trim() || "#56D6C9",
              sort_order: 10 + existingCount,
              is_active: true,
            });

            setNewGoalTarget("");
          }}
        >
          ➕ Add goal
        </button>
      </div>

      {/* Manage extra goals (hide/delete) */}
      {goals.filter((g) => g.key !== "savings" && g.key !== "student_loans").length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 950 }}>Manage extra goals</div>

          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {goals
              .filter((g) => g.key !== "savings" && g.key !== "student_loans")
              .map((g) => (
                <div
                  key={g.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                    border: `1px solid ${css.border}`,
                    borderRadius: 14,
                    padding: "0.6rem 0.75rem",
                    background: `linear-gradient(135deg, ${css.lavenderSoft} 0%, ${css.mintSoft} 100%)`,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 950 }}>{g.title}</div>
                    <div style={{ color: css.muted, fontWeight: 750, marginTop: 2, fontSize: 13 }}>
                      Bucket: <b>{g.key}</b> • Target: <b>${money(Number(g.target ?? 0))}</b> • Status:{" "}
                      <b>{g.is_active ? "Active" : "Hidden"}</b>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <button
                      type="button"
                      style={btnSoft}
                      disabled={savingGoals}
                      onClick={async () => {
                        const session = await ensureSession().catch(() => null);
                        const uid = session?.user?.id;
                        if (!uid) return;
                        await toggleGoal(uid, g);
                      }}
                    >
                      {g.is_active ? "Hide" : "Show"}
                    </button>

                    <button
                      type="button"
                      style={{ ...btnBase, color: "var(--danger, crimson)" }}
                      disabled={savingGoals}
                      onClick={async () => {
                        const session = await ensureSession().catch(() => null);
                        const uid = session?.user?.id;
                        if (!uid) return;
                        await deleteGoal(uid, g);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  </div>
)}

            </section>

            {/* Snapshot totals */}
            <section style={{ ...cardStyle }}>
              <div style={{ height: 10, borderRadius: 999, background: `linear-gradient(90deg, ${css.mintSoft}, ${css.pinkSoft})`, marginBottom: 12 }} />
              <div style={{ fontWeight: 950, fontSize: 16, marginBottom: 12 }}>Snapshot totals</div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
                <StatPill title="Savings" value={totals.savings} stripBg={strip("savings")} />
                <StatPill title="Student Loans" value={totals.student_loans} stripBg={strip("student_loans")} />
                <StatPill title="Emergency" value={totals.emergency} stripBg={strip("emergency")} />
                <StatPill title="Extra Money" value={totals.extra_money} stripBg={strip("extra_money")} />
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

/** Small inline editor row for targets */
function GoalEditRow({
  label,
  defaultTarget,
  currentTarget,
  onSave,
}: {
  label: string;
  defaultTarget: number;
  currentTarget: number;
  onSave: (target: number) => Promise<void>;
}) {
  const [val, setVal] = useState(String(currentTarget ?? defaultTarget));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVal(String(currentTarget ?? defaultTarget));
  }, [currentTarget, defaultTarget]);

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
      <div style={{ minWidth: 280, fontWeight: 900 }}>{label}</div>

      <label style={{ fontWeight: 850 }}>
        Amount
        <input
          inputMode="decimal"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          style={{
            display: "block",
            marginTop: 6,
            padding: "0.55rem 0.7rem",
            borderRadius: 14,
            border: `1px solid ${css.border}`,
            background: css.card,
            color: css.text,
          }}
        />
      </label>

<button
  type="button"
  disabled={saving}
  style={{
    borderRadius: 14,
    padding: "0.55rem 0.9rem",
    cursor: "pointer",
    fontWeight: 900,
    border: "1px solid var(--borderStrong)",
    background: "linear-gradient(135deg, var(--accent), var(--accentSoft))",
    color: "var(--onPrimary)", // 👈 IMPORTANT
    boxShadow: "var(--shadowStrong)",
    opacity: saving ? 0.7 : 1,
  }}
>
  {saving ? "Saving…" : "Save"}
</button>

    </div>
  );
}

function ThemeDropdownSmall() {
  const { theme, setTheme, isLoading } = useTheme();

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontWeight: 800, color: "var(--muted)", fontSize: 13 }}>
        Theme
      </span>

      <select
        value={theme}
        disabled={isLoading}
        onChange={(e) => setTheme(e.target.value as ThemeId)}
        style={{
          height: 38,
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--card)",
          color: "var(--text)",
          padding: "0 10px",
          fontWeight: 850,
          boxShadow: "var(--shadowSoft)",
          cursor: isLoading ? "not-allowed" : "pointer",
        }}
        aria-label="Theme"
      >
        <option value="neutral">Neutral</option>
        <option value="soft">🌸 Soft</option>
        <option value="cool">❄️ Cool</option>
        <option value="dark">🌙 Dark</option>
        <option value="mint">🌿 Mint</option>
      </select>
    </label>
  );
}
