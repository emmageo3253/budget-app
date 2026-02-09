"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/** ---------- Theme vars (with fallbacks so gradients never break) ---------- */
const css = {
  bg: "var(--bg, #FFF7FB)",
  card: "var(--card, #FFFFFF)",
  border: "var(--border, #F1D3E3)",
  text: "var(--text, #2B2B2B)",
  muted: "var(--muted, #6B5B66)",
  shadow: "var(--shadow, 0 14px 30px rgba(255, 125, 182, 0.12))",
  shadowSoft: "var(--shadowSoft, 0 10px 22px rgba(0,0,0,0.06))",

  pinkSoft: "var(--pinkSoft, #FFE1EF)",
  lavenderSoft: "var(--lavenderSoft, #EEE9FF)",
  mintSoft: "var(--mintSoft, #E8FBF6)",
  peachSoft: "var(--peachSoft, #FFF0E8)",
};

/** ---------- Styles ---------- */
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
};

const inputStyle: React.CSSProperties = {
  display: "block",
  padding: "0.55rem 0.7rem",
  minWidth: 170,
  background: css.card,
  color: css.text,
  border: `1px solid ${css.border}`,
  borderRadius: 14,
  outline: "none",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
};

const selectStyle: React.CSSProperties = { ...inputStyle };

/** Page gradient wash (theme-aware) */
const pageBg = `linear-gradient(180deg, ${css.bg} 0%, ${css.pinkSoft} 55%, ${css.bg} 100%)`;

function money(n: number) {
  const x = Number(n ?? 0);
  return (Math.round(x * 100) / 100).toFixed(2);
}

function strip(key: string) {
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

/** ---------- bucket_collections row ---------- */
type BucketCollectionRow = {
  id: string;
  user_id: string;
  week_start: string; // YYYY-MM-DD
  bucket: string;
  amount: number;
  created_at?: string;
};

/** ---------- Trackers ---------- */
type TrackerBucket = "savings" | "student_loans" | "emergency" | "extra_money";

function trackerForRawBucket(raw: string): TrackerBucket {
  const x = (raw ?? "").toLowerCase().trim();
  if (x === "save") return "savings";
  if (x === "student loans") return "student_loans";
  if (x === "emergency") return "emergency";
  return "extra_money";
}

function prettyTracker(t: TrackerBucket) {
  if (t === "student_loans") return "Student Loans";
  if (t === "extra_money") return "Extra Money";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function prettyRaw(raw: string) {
  const x = (raw ?? "").toLowerCase().trim();
  if (!x) return "Unknown";
  if (x === "student loans") return "Student Loans";
  if (x === "extra money") return "Extra Money";
  return x.charAt(0).toUpperCase() + x.slice(1);
}

function formatWeekLabel(weekStart: string) {
  return `Week of ${weekStart}`;
}

/** Map tracker -> bucket_collections.bucket (for adjustment rows) */
function rawBucketForTracker(tracker: TrackerBucket): string {
  if (tracker === "savings") return "save";
  if (tracker === "student_loans") return "student loans";
  if (tracker === "emergency") return "emergency";
  return "extra money";
}

/** ---------- Component ---------- */
function SavingsPage() {
  const router = useRouter();

  const [rows, setRows] = useState<BucketCollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedWeek, setSelectedWeek] = useState<string>("");

  // Adjust totals UI
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjTracker, setAdjTracker] = useState<TrackerBucket>("extra_money");
  const [adjDirection, setAdjDirection] = useState<"add" | "subtract">("subtract");
  const [adjAmount, setAdjAmount] = useState<string>("");
  const [adjNote, setAdjNote] = useState<string>("");
  const [adjSaving, setAdjSaving] = useState(false);

  async function ensureSignedIn() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.replace("/login");
      router.refresh();
      return false;
    }
    return true;
  }

  async function load() {
    setLoading(true);
    setErrorMsg(null);

    const ok = await ensureSignedIn();
    if (!ok) {
      setRows([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("bucket_collections")
      .select("id, user_id, week_start, bucket, amount, created_at")
      .order("week_start", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMsg(error.message);
      setRows([]);
      setSelectedWeek("");
    } else {
      const nextRows = (data ?? []) as BucketCollectionRow[];
      setRows(nextRows);

      const mostRecentWeek = nextRows.find((r) => r.week_start)?.week_start ?? "";
      setSelectedWeek((prev) => prev || mostRecentWeek);
    }

    setLoading(false);
  }

  async function adjustTrackerTotal() {
    setErrorMsg(null);

    const ok = await ensureSignedIn();
    if (!ok) return;

    if (!selectedWeek) {
      setErrorMsg("Pick a week before adjusting totals.");
      return;
    }

    const amt = Number(adjAmount);
    if (!adjAmount || !Number.isFinite(amt) || amt <= 0) {
      setErrorMsg("Enter an amount greater than 0.");
      return;
    }

    setAdjSaving(true);

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const uid = userData.user?.id;

    if (userErr || !uid) {
      setErrorMsg(userErr?.message ?? "No user found.");
      setAdjSaving(false);
      return;
    }

    const baseBucket = rawBucketForTracker(adjTracker);
    const signed = adjDirection === "subtract" ? -amt : amt;

    const note = adjNote.trim();
    const bucket = note ? `${baseBucket} (${note})` : baseBucket;

    const { error } = await supabase.from("bucket_collections").insert({
      user_id: uid,
      week_start: selectedWeek,
      bucket,
      amount: Number(signed),
    });

    if (error) {
      setErrorMsg(error.message);
      setAdjSaving(false);
      return;
    }

    setAdjAmount("");
    setAdjNote("");
    setAdjSaving(false);
    setAdjOpen(false);
    await load();
  }

  useEffect(() => {
    load();
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

  const byWeek = useMemo(() => {
    const m = new Map<string, BucketCollectionRow[]>();

    for (const r of rows) {
      if (!r.week_start) continue;
      if (!m.has(r.week_start)) m.set(r.week_start, []);
      m.get(r.week_start)!.push(r);
    }

    const arr = Array.from(m.entries()).map(([weekStart, list]) => {
      const sums: Record<TrackerBucket, number> = {
        savings: 0,
        student_loans: 0,
        emergency: 0,
        extra_money: 0,
      };

      for (const r of list) {
        const k = trackerForRawBucket(r.bucket);
        sums[k] += Number(r.amount ?? 0);
      }

      return { weekStart, list, sums };
    });

    arr.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    return arr;
  }, [rows]);

  const selected = useMemo(() => {
    if (!selectedWeek) return null;
    return byWeek.find((w) => w.weekStart === selectedWeek) ?? null;
  }, [byWeek, selectedWeek]);

  const weekOptions = useMemo(() => byWeek.map((w) => w.weekStart), [byWeek]);

  return (
    <main
      style={{
        width: "100%",
        maxWidth: "100%",
        // ✅ gradient wash BACK (theme-aware)
        background: pageBg,
        minHeight: "100vh",
        color: css.text,
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
        {/* Header */}
        <header style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 36, fontWeight: 950, letterSpacing: "-0.02em" }}>💖 Savings Trackers</h1>
              <div style={{ marginTop: 8, color: css.muted, fontWeight: 700 }}>
                Savings • Student Loans • Emergency • Extra Money
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => setAdjOpen((v) => !v)} style={btnBase}>
                ✏️ Adjust totals
              </button>
              <button onClick={load} style={btnBase}>
                🔄 Refresh
              </button>
            </div>
          </div>
        </header>

        {errorMsg && (
          <div style={{ ...cardStyle, borderColor: "rgba(220,20,60,0.35)", marginBottom: "1rem" }}>
            <div style={{ fontWeight: 950, color: "crimson" }}>Savings error:</div>
            <div style={{ marginTop: 6, color: css.muted, fontWeight: 750 }}>{errorMsg}</div>
          </div>
        )}

        {/* Adjust totals panel */}
        {adjOpen && (
          <section
            style={{
              ...cardStyle,
              marginBottom: "1.25rem",
              // ✅ subtle card wash stays theme-aware
              background: `linear-gradient(135deg, ${css.card} 0%, ${css.pinkSoft} 120%)`,
            }}
          >
            <div style={{ height: 10, borderRadius: 999, background: `linear-gradient(90deg, ${css.peachSoft}, ${css.pinkSoft})`, marginBottom: 12 }} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 950, fontSize: 16 }}>Adjust a tracker total</div>
                <div style={{ marginTop: 6, color: css.muted, fontWeight: 700, fontSize: 13 }}>
                  This adds an adjustment row to the selected week (so your totals update correctly).
                </div>
              </div>

              <div style={{ color: css.muted, fontWeight: 900, fontSize: 13 }}>
                Week: <span style={{ color: css.text }}>{selectedWeek ? formatWeekLabel(selectedWeek) : "none selected"}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginTop: 14 }}>
              <label style={{ fontWeight: 900 }}>
                Tracker
                <select
                  value={adjTracker}
                  onChange={(e) => setAdjTracker(e.target.value as TrackerBucket)}
                  style={{ ...selectStyle, marginTop: 6, minWidth: 220 }}
                >
                  <option value="savings">Savings</option>
                  <option value="student_loans">Student Loans</option>
                  <option value="emergency">Emergency</option>
                  <option value="extra_money">Extra Money</option>
                </select>
              </label>

              <label style={{ fontWeight: 900 }}>
                Action
                <select
                  value={adjDirection}
                  onChange={(e) => setAdjDirection(e.target.value as "add" | "subtract")}
                  style={{ ...selectStyle, marginTop: 6, minWidth: 200 }}
                >
                  <option value="add">Add (money coming in)</option>
                  <option value="subtract">Subtract (spend / gift / transfer out)</option>
                </select>
              </label>

              <label style={{ fontWeight: 900 }}>
                Amount
                <input
                  inputMode="decimal"
                  placeholder="100"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  style={{ ...inputStyle, marginTop: 6, minWidth: 160 }}
                />
              </label>

              <label style={{ fontWeight: 900, flex: 1, minWidth: 220 }}>
                Note (optional)
                <input
                  placeholder="gift / venmo / etc"
                  value={adjNote}
                  onChange={(e) => setAdjNote(e.target.value)}
                  style={{ ...inputStyle, marginTop: 6, width: "100%" }}
                />
              </label>

              <button
                onClick={adjustTrackerTotal}
                disabled={adjSaving}
                style={{
                  ...btnBase,
                  background: `linear-gradient(135deg, ${css.pinkSoft} 0%, ${css.lavenderSoft} 100%)`,
                  opacity: adjSaving ? 0.7 : 1,
                }}
              >
                {adjSaving ? "Saving..." : "Save adjustment"}
              </button>

              <button
                onClick={() => {
                  setAdjOpen(false);
                  setAdjAmount("");
                  setAdjNote("");
                }}
                style={btnBase}
                disabled={adjSaving}
              >
                Cancel
              </button>
            </div>
          </section>
        )}

        {/* Totals */}
        <section
          style={{
            ...cardStyle,
            marginBottom: "1.25rem",
            // ✅ bring back that “pretty container glow”
            background: `linear-gradient(135deg, ${css.card} 0%, ${css.lavenderSoft} 140%)`,
          }}
        >
          <div style={{ height: 10, borderRadius: 999, background: `linear-gradient(90deg, ${css.pinkSoft}, ${css.mintSoft})`, marginBottom: 12 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            <StatCard title="Savings" strip={strip("savings")} value={totals.savings} />
            <StatCard title="Student Loans" strip={strip("student_loans")} value={totals.student_loans} />
            <StatCard title="Emergency" strip={strip("emergency")} value={totals.emergency} />
            <StatCard title="Extra Money" strip={strip("extra_money")} value={totals.extra_money} />
          </div>
        </section>

        {/* Week-by-week */}
        <section>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ marginBottom: "0.75rem", fontSize: 18, fontWeight: 950 }}>Week-by-week</h2>
            <div style={{ color: css.muted, fontWeight: 750, fontSize: 13 }}>
              {loading ? "Loading…" : `${byWeek.length} week(s)`}
            </div>
          </div>

          {loading ? (
            <p style={{ color: css.muted, fontWeight: 700 }}>Loading…</p>
          ) : byWeek.length === 0 ? (
            <div style={cardStyle}>
              <div style={{ height: 10, borderRadius: 999, background: strip("extra_money"), marginBottom: 12 }} />
              <div style={{ fontWeight: 900 }}>No collections yet</div>
              <div style={{ color: css.muted, fontWeight: 650, marginTop: 6 }}>
                Try pressing <span style={{ fontWeight: 900, color: css.text }}>Collect</span> on a bucket on the Dashboard.
              </div>
            </div>
          ) : (
            <div
              style={{
                ...cardStyle,
                padding: "0.9rem 1rem",
                // ✅ subtle wash like your screenshot
                background: `linear-gradient(135deg, ${css.card} 0%, ${css.pinkSoft} 180%)`,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      background: `linear-gradient(180deg, ${css.lavenderSoft}, ${css.pinkSoft})`,
                      border: `1px solid ${css.border}`,
                      boxShadow: "0 6px 14px rgba(0,0,0,0.06)",
                    }}
                  />
                  <div style={{ fontWeight: 950, fontSize: 16 }}>Select week</div>
                </div>

                <select
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(e.target.value)}
                  style={{
                    border: `1px solid ${css.border}`,
                    borderRadius: 14,
                    padding: "0.55rem 0.7rem",
                    fontWeight: 900,
                    background: css.card,
                    color: css.text,
                    boxShadow: css.shadowSoft,
                    minWidth: 220,
                    cursor: "pointer",
                  }}
                >
                  {weekOptions.map((ws) => (
                    <option key={ws} value={ws}>
                      {formatWeekLabel(ws)}
                    </option>
                  ))}
                </select>
              </div>

              {selected ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ height: 10, borderRadius: 999, background: `linear-gradient(90deg, ${css.lavenderSoft}, ${css.pinkSoft})`, marginBottom: 12 }} />

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                    <MiniStat title="Savings" value={selected.sums.savings} />
                    <MiniStat title="Student Loans" value={selected.sums.student_loans} />
                    <MiniStat title="Emergency" value={selected.sums.emergency} />
                    <MiniStat title="Extra Money" value={selected.sums.extra_money} />
                  </div>

                  <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                    {selected.list.map((r) => {
                      const tracker = trackerForRawBucket(r.bucket);
                      return (
                        <div
                          key={r.id}
                          style={{
                            borderRadius: 16,
                            padding: "0.75rem 0.85rem",
                            // ✅ keeps the pretty row gradient but theme-aware
                            background: `linear-gradient(135deg, ${css.lavenderSoft} 0%, ${css.mintSoft} 100%)`,
                            border: `1px solid ${css.border}`,
                            boxShadow: "0 8px 18px rgba(0,0,0,0.05)",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 950 }}>{prettyTracker(tracker)}</div>
                            <div style={{ color: css.muted, fontWeight: 700, marginTop: 2, fontSize: 13 }}>
                              From: {prettyRaw(r.bucket)}
                            </div>
                          </div>

                          <div style={{ fontWeight: 950, whiteSpace: "nowrap" }}>
                            {Number(r.amount ?? 0) < 0 ? "-" : ""}${money(Math.abs(Number(r.amount ?? 0)))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 10, color: css.muted, fontWeight: 700 }}>Pick a week.</div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default SavingsPage;

function StatCard({ title, value, strip }: { title: string; value: number; strip: string }) {
  return (
    <div
      style={{
        border: `1px solid ${css.border}`,
        background: css.card,
        borderRadius: 18,
        padding: 14,
        boxShadow: css.shadowSoft,
        color: css.text,
      }}
    >
      <div style={{ height: 8, borderRadius: 999, background: strip, marginBottom: 10 }} />
      <div style={{ fontWeight: 900, opacity: 0.8 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 950, marginTop: 8 }}>${money(value)}</div>
    </div>
  );
}

function MiniStat({ title, value }: { title: string; value: number }) {
  return (
    <div
      style={{
        border: `1px solid ${css.border}`,
        background: `linear-gradient(135deg, ${ predominately(css.pinkSoft) } 0%, ${css.lavenderSoft} 100%)`,
        borderRadius: 16,
        padding: 10,
        color: css.text,
      }}
    >
      <div style={{ fontWeight: 900, opacity: 0.75, fontSize: 12 }}>{title}</div>
      <div style={{ fontWeight: 950, marginTop: 4 }}>${money(value)}</div>
    </div>
  );
}

/** Helper: keep MiniStat gradient readable across themes */
function predominately(v: string) {
  // leave it as-is; this exists so it's easy to tune later without hunting styles
  return v;
}
