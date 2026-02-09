"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/** ---------- Types ---------- */
type Transaction = {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  amount: number; // expenses negative, income positive
  category: string; // stored as "bucket::raw" (new) or "raw" (legacy)
  description: string | null;
  created_at: string;
};

type Budget = {
  id: string;
  user_id: string;
  week_start: string; // YYYY-MM-DD
  category: string; // save, wants, emergency, student loans, expenses
  amount: number; // positive
  created_at: string;
};

type CategoryMapRow = {
  id: string;
  user_id: string;
  raw_category: string;
  bucket: string;
  created_at: string;
};

type UserPreferences = {
  user_id: string;
  week_start_dow: number; // 0..6
  notice_dow: number | null;
  updated_at: string;
};

type WeeklyIncome = {
  id: string;
  user_id: string;
  week_start: string;
  amount: number;
  created_at: string;
  updated_at: string;
};

type BucketTransfer = {
  id: string;
  user_id: string;
  week_start: string;
  from_bucket: string;
  to_bucket: string;
  amount: number;
  created_at: string;
};

type DisplayItem =
  | { kind: "tx"; tx: Transaction }
  | { kind: "transfer_out"; tr: BucketTransfer }
  | { kind: "transfer_in"; tr: BucketTransfer };

type Row = {
  category: string;
  budgeted: number; // effective budget after transfers
  spent: number;
  variance: number; // budgeted - spent
};

/** ---------- Constants ---------- */
const ALLOCATIONS: Array<{ category: string; pct: number }> = [
  { category: "save", pct: 0.15 },
  { category: "wants", pct: 0.15 },
  { category: "emergency", pct: 0.1 },
  { category: "student loans", pct: 0.25 },
  { category: "expenses", pct: 0.3 }, // leftover cents added here
];

const BUCKETS = ALLOCATIONS.map((a) => a.category);

/** ---------- Date helpers ---------- */
function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISODate(d);
}
function todayISO() {
  return toISODate(new Date());
}
function dowName(dow: number) {
  return (
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dow] ??
    "Day"
  );
}
function mostRecentDowISO(date: Date, targetDow: number) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - targetDow + 7) % 7;
  d.setDate(d.getDate() - diff);
  return toISODate(d);
}
function nextDowISO(date: Date, targetDow: number) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (targetDow - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}
function weekStartForIncomeEntryISO(entryDate: Date, paydayDow: number, noticeDow: number | null) {
  const entryDow = entryDate.getDay();
  if (noticeDow !== null && entryDow === noticeDow) return nextDowISO(entryDate, paydayDow);
  return mostRecentDowISO(entryDate, paydayDow);
}

/** ---------- Money helpers (cents-safe) ---------- */
function money(n: number) {
  return (Math.round(n * 100) / 100).toFixed(2);
}
function clamp2(n: number) {
  return Math.round(n * 100) / 100;
}
function toCents(n: number) {
  return Math.round(n * 100);
}
function centsToNumber(cents: number) {
  return Math.round(cents) / 100;
}

/**
 * Build budgets in cents so total equals income exactly.
 * Round each bucket, then add leftover cents to "expenses".
 */
function buildBudgetInsertsExactTotal(params: { userId: string; weekStart: string; income: number }) {
  const incomeCents = toCents(params.income);

  const centsByBucket = new Map<string, number>();
  for (const a of ALLOCATIONS) {
    const c = Math.round(incomeCents * a.pct);
    centsByBucket.set(a.category, c);
  }

  const sumCents = Array.from(centsByBucket.values()).reduce((s, c) => s + c, 0);
  const leftover = incomeCents - sumCents;

  centsByBucket.set("expenses", (centsByBucket.get("expenses") ?? 0) + leftover);

  return BUCKETS.map((bucket) => ({
    user_id: params.userId,
    week_start: params.weekStart,
    category: bucket,
    amount: centsToNumber(centsByBucket.get(bucket) ?? 0),
  }));
}

/** ---------- Bucket-locked transaction category helpers ---------- */
const TX_BUCKET_DELIM = "::";
function makeStoredCategory(bucket: string, raw: string) {
  return `${bucket}${TX_BUCKET_DELIM}${raw}`;
}
function splitStoredCategory(category: string): { bucket: string | null; raw: string } {
  const idx = category.indexOf(TX_BUCKET_DELIM);
  if (idx > 0) {
    const b = category.slice(0, idx).trim();
    const raw = category.slice(idx + TX_BUCKET_DELIM.length).trim();
    if (BUCKETS.includes(b) && raw) return { bucket: b, raw };
  }
  return { bucket: null, raw: category };
}
function isISOInRange(d: string, start: string, end: string) {
  return d >= start && d <= end; // YYYY-MM-DD lexicographically safe
}

/** ---------- Theme (CSS variables only; no hardcoded colors) ---------- */
const THEME = {
  bg: "var(--bg)",
  card: "var(--card)",
  border: "var(--border)",
  borderSubtle: "var(--borderSubtle)",
  text: "var(--text)",
  muted: "var(--muted)",

  soft1: "var(--soft1)",
  soft2: "var(--soft2)",
  soft3: "var(--soft3)",
  soft4: "var(--soft4)",

  pinkSoft: "var(--pinkSoft)",
  lavenderSoft: "var(--lavenderSoft)",
  mintSoft: "var(--mintSoft)",
  peachSoft: "var(--peachSoft)",

  accent: "var(--accent)",

  shadow: "var(--shadow)",
  shadowSoft: "var(--shadowSoft)",
  shadowStrong: "var(--shadowStrong)",

  danger: "var(--danger)",
  onPrimary: "var(--onPrimary)",
  borderStrong: "var(--borderStrong)",
  insetHighlight: "var(--insetHighlight)",

  txCardShadow: "var(--txCardShadow)",
};

/** ---------- Theme-aware bucket icons ---------- */
function useThemeName() {
  const [theme, setTheme] = useState<string>(() => {
    if (typeof document === "undefined") return "soft";
    return (
      document.documentElement.getAttribute("data-theme") ||
      document.body.getAttribute("data-theme") ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null) ||
      "soft"
    );
  });

  useEffect(() => {
    if (typeof document === "undefined") return;

    const readTheme = () =>
      document.documentElement.getAttribute("data-theme") ||
      document.body.getAttribute("data-theme") ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("theme") : null) ||
      "soft";

    const update = () => setTheme(readTheme());

    // Observe data-theme changes (works with most switchers)
    const el = document.documentElement;
    const obs = new MutationObserver(() => update());
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });

    // Also listen to storage changes (if your switcher uses localStorage)
    const onStorage = (e: StorageEvent) => {
      if (e.key === "theme") update();
    };
    window.addEventListener("storage", onStorage);

    // Optional: if your switcher dispatches a custom event
    const onThemeEvent = () => update();
    window.addEventListener("themechange", onThemeEvent as any);

    // Initial
    update();

    return () => {
      obs.disconnect();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("themechange", onThemeEvent as any);
    };
  }, []);

  return theme;
}

const bucketIconsByTheme: Record<string, Record<string, string>> = {
  // your soft theme icons ✅
  soft: {
    save: "💗",
    wants: "🎀",
    emergency: "🩹",
    "student loans": "🎓",
    expenses: "🧾",
  },

  // examples for other themes (edit these to whatever vibe you want)
  dark: {
    save: "🫧",
    wants: "🪩",
    emergency: "🛡️",
    "student loans": "📚",
    expenses: "🧾",
  },

  neutral: {
    save: "✨",
    wants: "🧁",
    emergency: "🩺",
    "student loans": "📘",
    expenses: "🧾",
  },
};

function getBucketIcon(themeName: string, bucket: string) {
  const t = (themeName || "soft").toLowerCase();
  const map =
    bucketIconsByTheme[t] ||
    bucketIconsByTheme[t.split("-")[0]] || // supports "soft-pastel", "dark-v2", etc.
    bucketIconsByTheme.soft;
  return map[bucket] ?? "✨";
}

/** ---------- Bucket strip backgrounds (still theme-safe) ---------- */
function bucketStripBg(bucket: string) {
  switch (bucket) {
    case "save":
      return `linear-gradient(90deg, ${THEME.soft1}, ${THEME.soft2})`;
    case "wants":
      return `linear-gradient(90deg, ${THEME.soft4}, ${THEME.soft1})`;
    case "emergency":
      return `linear-gradient(90deg, ${THEME.soft3}, ${THEME.soft2})`;
    case "student loans":
      return `linear-gradient(90deg, ${THEME.soft2}, ${THEME.soft1})`;
    case "expenses":
    default:
      return `linear-gradient(90deg, ${THEME.soft4}, ${THEME.soft3})`;
  }
}

/** ---------- Styles ---------- */
const inputStyle: React.CSSProperties = {
  display: "block",
  padding: "0.55rem 0.7rem",
  minWidth: 180,
  background: THEME.card,
  color: THEME.text,
  border: `1px solid ${THEME.border}`,
  borderRadius: 14,
  outline: "none",
  boxShadow: `inset 0 1px 0 ${THEME.insetHighlight}`,
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const btnBase: React.CSSProperties = {
  borderRadius: 999,
  padding: "0.65rem 1rem",
  cursor: "pointer",
  fontWeight: 900,
  border: `1px solid ${THEME.border}`,
  background: THEME.card,
  color: THEME.text,
  boxShadow: THEME.shadowSoft,
  transition: "transform 120ms ease, box-shadow 120ms ease, filter 120ms ease",
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  border: `1px solid ${THEME.borderStrong}`,
  background: `linear-gradient(135deg, ${THEME.soft1} 0%, ${THEME.soft2} 100%)`,
  color: THEME.onPrimary,
  boxShadow: THEME.shadowStrong,
};

const btnSoft: React.CSSProperties = {
  ...btnBase,
  background: `linear-gradient(135deg, ${THEME.accent} 0%, ${THEME.soft2} 100%)`,
};

const cardStyle: React.CSSProperties = {
  border: `1px solid ${THEME.border}`,
  borderRadius: 18,
  padding: "1rem",
  background: THEME.card,
  color: THEME.text,
  boxShadow: THEME.shadow,
};

function pressHandlers() {
  return {
    onMouseDown: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.transform = "scale(0.98)";
      e.currentTarget.style.filter = "brightness(0.98)";
    },
    onMouseUp: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.transform = "scale(1)";
      e.currentTarget.style.filter = "none";
    },
    onMouseLeave: (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.transform = "scale(1)";
      e.currentTarget.style.filter = "none";
    },
  };
}

/** ---------- Component ---------- */
export default function Dashboard() {
  const router = useRouter();
  const themeName = useThemeName();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Week being viewed
  const [weekStart, setWeekStart] = useState<string | null>(null);

  // Data
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [weeklyIncome, setWeeklyIncome] = useState<WeeklyIncome | null>(null); // internal: used to build budgets
  const [categoryMap, setCategoryMap] = useState<CategoryMapRow[]>([]);
  const [transfers, setTransfers] = useState<BucketTransfer[]>([]);

  // Preferences (still used for week alignment logic; pay schedule UI moved to Home)
  const [prefs, setPrefs] = useState<{ paydayDow: number; noticeDow: number | null }>({
    paydayDow: 5, // Friday
    noticeDow: 4, // Thursday
  });

  // Add-week UI
  const [showAddWeek, setShowAddWeek] = useState(false);
  const [incomeInput, setIncomeInput] = useState("");
  const [addingWeek, setAddingWeek] = useState(false);
  const [newWeekStartDate, setNewWeekStartDate] = useState<string>(todayISO());

  // Bucket UI
  const [openBucket, setOpenBucket] = useState<string | null>(null);

  // ✅ single “active add bucket”
  const [activeAddBucket, setActiveAddBucket] = useState<string | null>(null);

  // Add transaction fields
  const [txDate, setTxDate] = useState(todayISO());
  const [txType, setTxType] = useState<"expense" | "income">("expense");
  const [txAmount, setTxAmount] = useState("");
  const [txRawCategory, setTxRawCategory] = useState("");
  const [txDescription, setTxDescription] = useState("");
  const [addingTx, setAddingTx] = useState(false);

  // Edit mode for transactions
  const [editBucket, setEditBucket] = useState<string | null>(null);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState(todayISO());
  const [editType, setEditType] = useState<"expense" | "income">("expense");
  const [editAmount, setEditAmount] = useState("");
  const [editRawCategory, setEditRawCategory] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Collect state (for disabling pull-from)
  const [collectedSet, setCollectedSet] = useState<Set<string>>(new Set());

  // Cover overspend UI state
  const [coverSource, setCoverSource] = useState<Record<string, string>>({});
  const [coverAmount, setCoverAmount] = useState<Record<string, string>>({});
  const [coveringBucket, setCoveringBucket] = useState<string | null>(null);

  // View week selector at bottom
  const [viewWeekInput, setViewWeekInput] = useState<string>(todayISO());

  /** ---------- Auth ---------- */
  async function ensureSignedIn() {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      router.replace("/login");
      router.refresh();
      return false;
    }
    return true;
  }

  /** ---------- Loaders ---------- */
  async function loadPreferencesReturn(): Promise<{ paydayDow: number; noticeDow: number | null }> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return { paydayDow: 5, noticeDow: 4 };

      const { data, error } = await supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", uid)
        .maybeSingle();

      if (error || !data) return { paydayDow: 5, noticeDow: 4 };

      const p = data as UserPreferences;
      return { paydayDow: p.week_start_dow, noticeDow: p.notice_dow };
    } catch {
      return { paydayDow: 5, noticeDow: 4 };
    }
  }

  async function loadCategoryMap(uid: string) {
    const { data: m, error: mErr } = await supabase.from("category_map").select("*").eq("user_id", uid);
    if (mErr) {
      setErrorMsg(mErr.message);
      setCategoryMap([]);
      return;
    }
    setCategoryMap((m ?? []) as CategoryMapRow[]);
  }

  async function loadWeekAll(ws: string) {
    setErrorMsg(null);

    const ok = await ensureSignedIn();
    if (!ok) return;

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (userErr || !uid) {
      setErrorMsg(userErr?.message ?? "No user found.");
      return;
    }

    const we = addDaysISO(ws, 6);

    await loadCategoryMap(uid);

    // internal income row for budget build
    const { data: incRow } = await supabase
      .from("weekly_income")
      .select("*")
      .eq("user_id", uid)
      .eq("week_start", ws)
      .maybeSingle();

    setWeeklyIncome((incRow as WeeklyIncome) ?? null);

    // budgets
    const { data: b, error: bErr } = await supabase.from("budgets").select("*").eq("user_id", uid).eq("week_start", ws);
    if (bErr) {
      setErrorMsg(bErr.message);
      setWeekStart(null);
      setBudgets([]);
      setTransactions([]);
      setCollectedSet(new Set());
      setTransfers([]);
      return;
    }

    setWeekStart(ws);
    setTxDate(ws);

    if (!b || b.length === 0) {
      setBudgets([]);
      setTransactions([]);
      setCollectedSet(new Set());
      setTransfers([]);
      return;
    }

    setBudgets(b as Budget[]);

    // transactions
    const { data: t } = await supabase
      .from("transactions")
      .select("*")
      .eq("user_id", uid)
      .gte("date", ws)
      .lte("date", we)
      .order("date", { ascending: false });

    setTransactions((t ?? []) as Transaction[]);

    // collected buckets
    const { data: c } = await supabase
      .from("bucket_collections")
      .select("bucket")
      .eq("user_id", uid)
      .eq("week_start", ws);

    setCollectedSet(new Set((c ?? []).map((x: any) => x.bucket)));

    // transfers
    const { data: tr, error: trErr } = await supabase
      .from("bucket_transfers")
      .select("*")
      .eq("user_id", uid)
      .eq("week_start", ws)
      .order("created_at", { ascending: true });

    if (trErr) {
      setErrorMsg(trErr.message);
      setTransfers([]);
    } else {
      setTransfers((tr ?? []) as BucketTransfer[]);
    }
  }

  /** ---------- Derived ---------- */
  const mapDict = useMemo(() => {
    const d = new Map<string, string>();
    for (const row of categoryMap) d.set(row.raw_category, row.bucket);
    return d;
  }, [categoryMap]);

  const unmappedCategories = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      const parsed = splitStoredCategory(t.category);
      if (parsed.bucket) continue;
      if (!mapDict.has(t.category)) set.add(t.category);
    }
    return Array.from(set).sort();
  }, [transactions, mapDict]);

  const rows = useMemo<Row[]>(() => {
    const baseBudgetByBucket = new Map<string, number>();
    for (const b of budgets) baseBudgetByBucket.set(b.category, (baseBudgetByBucket.get(b.category) ?? 0) + Number(b.amount));

    const spentByBucket = new Map<string, number>();
    for (const t of transactions) {
      if (Number(t.amount) >= 0) continue;
      const parsed = splitStoredCategory(t.category);
      const bucket = parsed.bucket ?? mapDict.get(t.category);
      if (!bucket) continue;
      spentByBucket.set(bucket, (spentByBucket.get(bucket) ?? 0) + Math.abs(Number(t.amount)));
    }

    const deltaByBucket = new Map<string, number>();
    for (const tr of transfers) {
      const amt = Number(tr.amount);
      deltaByBucket.set(tr.from_bucket, (deltaByBucket.get(tr.from_bucket) ?? 0) - amt);
      deltaByBucket.set(tr.to_bucket, (deltaByBucket.get(tr.to_bucket) ?? 0) + amt);
    }

    return BUCKETS.map((bucket) => {
      const base = baseBudgetByBucket.get(bucket) ?? 0;
      const delta = deltaByBucket.get(bucket) ?? 0;
      const budgeted = clamp2(base + delta);
      const spent = clamp2(spentByBucket.get(bucket) ?? 0);
      return { category: bucket, budgeted, spent, variance: clamp2(budgeted - spent) };
    });
  }, [budgets, transactions, mapDict, transfers]);

  const totals = useMemo(() => {
    const totalBudgeted = rows.reduce((s, r) => s + r.budgeted, 0);
    const totalSpent = rows.reduce((s, r) => s + r.spent, 0);
    return {
      totalBudgeted: clamp2(totalBudgeted),
      totalSpent: clamp2(totalSpent),
      totalVariance: clamp2(totalBudgeted - totalSpent),
    };
  }, [rows]);

  const itemsByBucket = useMemo(() => {
    const obj: Record<string, DisplayItem[]> = {};
    for (const b of BUCKETS) obj[b] = [];

    for (const t of transactions) {
      const parsed = splitStoredCategory(t.category);
      const bucket = parsed.bucket ?? mapDict.get(t.category);
      if (!bucket) continue;
      obj[bucket].push({ kind: "tx", tx: t });
    }

    for (const tr of transfers) {
      if (obj[tr.from_bucket]) obj[tr.from_bucket].push({ kind: "transfer_out", tr });
      if (obj[tr.to_bucket]) obj[tr.to_bucket].push({ kind: "transfer_in", tr });
    }

    const ts = (x: DisplayItem) => {
      if (x.kind === "tx") return `${x.tx.date}T23:59:59.999Z|${x.tx.created_at}`;
      return `${x.tr.created_at}`;
    };

    for (const b of Object.keys(obj)) obj[b].sort((a, c) => ts(c).localeCompare(ts(a)));
    return obj;
  }, [transactions, transfers, mapDict]);

  function availableFromBucket(bucket: string) {
    const r = rows.find((x) => x.category === bucket);
    if (!r) return 0;
    if (collectedSet.has(bucket)) return 0;
    return Math.max(0, clamp2(r.variance));
  }

  /** ---------- Mutations ---------- */
  async function rebuildBudgetsForWeek(ws: string, income: number) {
    const ok = await ensureSignedIn();
    if (!ok) return false;

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (userErr || !uid) {
      setErrorMsg(userErr?.message ?? "No user found.");
      return false;
    }

    const { error: incErr } = await supabase.from("weekly_income").upsert({
      user_id: uid,
      week_start: ws,
      amount: clamp2(income),
      updated_at: new Date().toISOString(),
    });

    if (incErr) {
      setErrorMsg(incErr.message);
      return false;
    }

    await supabase.from("budgets").delete().eq("user_id", uid).eq("week_start", ws);
    await supabase.from("bucket_transfers").delete().eq("user_id", uid).eq("week_start", ws);

    const inserts = buildBudgetInsertsExactTotal({ userId: uid, weekStart: ws, income });
    const { error: insErr } = await supabase.from("budgets").insert(inserts);
    if (insErr) {
      setErrorMsg(insErr.message);
      return false;
    }

    return true;
  }

  async function addNewWeekFromIncome() {
    setErrorMsg(null);
    setAddingWeek(true);

    const income = Number(incomeInput);
    if (!incomeInput || Number.isNaN(income) || income <= 0) {
      setErrorMsg("Income must be a number greater than 0.");
      setAddingWeek(false);
      return;
    }

    const ws = newWeekStartDate?.trim()
      ? newWeekStartDate.trim()
      : weekStartForIncomeEntryISO(new Date(), prefs.paydayDow, prefs.noticeDow);

    const ok = await rebuildBudgetsForWeek(ws, income);
    setAddingWeek(false);
    if (!ok) return;

    setShowAddWeek(false);
    setIncomeInput("");
    await loadWeekAll(ws);
  }

  async function upsertMapping(raw_category: string, bucket: string) {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (userErr || !uid) {
      setErrorMsg(userErr?.message ?? "No user found.");
      return false;
    }

    const { error } = await supabase.from("category_map").upsert({ user_id: uid, raw_category, bucket });
    if (error) {
      setErrorMsg(error.message);
      return false;
    }

    await loadCategoryMap(uid);
    return true;
  }

  async function addTransactionForBucket(bucket: string, e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setAddingTx(true);

    try {
      if (!weekStart) {
        setErrorMsg("Choose or create a week first.");
        return;
      }

      const ok = await ensureSignedIn();
      if (!ok) return;

      const raw = txRawCategory.trim();
      const amt = Number(txAmount);

      if (!raw) {
        setErrorMsg("Category name is required (ex: Crumbl, Gas, Rent).");
        return;
      }
      if (!txAmount || Number.isNaN(amt) || amt <= 0) {
        setErrorMsg("Amount must be a number greater than 0.");
        return;
      }
      if (!txDate) {
        setErrorMsg("Date is required.");
        return;
      }

      const weekEnd = addDaysISO(weekStart, 6);
      if (!isISOInRange(txDate, weekStart, weekEnd)) {
        setErrorMsg(`That date (${txDate}) is not in this week (${weekStart} to ${weekEnd}).`);
        return;
      }

      const { data: userData, error: userErr } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (userErr || !uid) {
        setErrorMsg(userErr?.message ?? "No user found.");
        return;
      }

      const signedAmount = txType === "expense" ? -amt : amt;
      const storedCategory = makeStoredCategory(bucket, raw);

      const { error } = await supabase.from("transactions").insert({
        user_id: uid,
        date: txDate,
        amount: signedAmount,
        category: storedCategory,
        description: txDescription.trim() ? txDescription.trim() : null,
      });

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setTxType("expense");
      setTxAmount("");
      setTxRawCategory("");
      setTxDescription("");
      setTxDate(weekStart);

      setActiveAddBucket(null);
      setOpenBucket(bucket);

      await loadWeekAll(weekStart);
    } finally {
      setAddingTx(false);
    }
  }

  async function updateTransaction(tx: Transaction) {
    setErrorMsg(null);
    setSavingEdit(true);

    try {
      const ok = await ensureSignedIn();
      if (!ok) return;

      const amt = Number(editAmount);
      if (!editAmount || Number.isNaN(amt) || amt <= 0) {
        setErrorMsg("Amount must be a number greater than 0.");
        return;
      }

      const raw = editRawCategory.trim();
      if (!raw) {
        setErrorMsg("Raw category is required.");
        return;
      }
      if (!editDate) {
        setErrorMsg("Date is required.");
        return;
      }

      if (weekStart) {
        const weekEnd = addDaysISO(weekStart, 6);
        if (!isISOInRange(editDate, weekStart, weekEnd)) {
          setErrorMsg(`That date (${editDate}) is not in this week (${weekStart} to ${weekEnd}).`);
          return;
        }
      }

      const signedAmount = editType === "expense" ? -amt : amt;

      const parsed = splitStoredCategory(tx.category);
      const lockedBucket = parsed.bucket;

      if (!lockedBucket) {
        const currentBucket = mapDict.get(tx.category);
        if (currentBucket) {
          const existing = mapDict.get(raw);
          if (!existing || existing !== currentBucket) {
            const okMap = await upsertMapping(raw, currentBucket);
            if (!okMap) return;
          }
        }
      }

      const nextCategory = lockedBucket ? makeStoredCategory(lockedBucket, raw) : raw;

      const { error } = await supabase
        .from("transactions")
        .update({
          date: editDate,
          amount: signedAmount,
          category: nextCategory,
          description: editDescription.trim() ? editDescription.trim() : null,
        })
        .eq("id", tx.id);

      if (error) {
        setErrorMsg(error.message);
        return;
      }

      setEditingTxId(null);
      if (weekStart) await loadWeekAll(weekStart);
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteTransaction(id: string) {
    setErrorMsg(null);

    const ok = await ensureSignedIn();
    if (!ok) return;

    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      setErrorMsg(error.message);
      return;
    }

    if (editingTxId === id) setEditingTxId(null);
    if (weekStart) await loadWeekAll(weekStart);
  }

  async function saveMapping(raw_category: string, bucket: string) {
    setErrorMsg(null);
    const ok = await ensureSignedIn();
    if (!ok) return;

    await upsertMapping(raw_category, bucket);
    if (weekStart) await loadWeekAll(weekStart);
  }

  async function collectBucket(bucket: string, amount: number) {
    setErrorMsg(null);
    if (amount <= 0) return;

    const ok = await ensureSignedIn();
    if (!ok) return;

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (userErr || !uid) {
      setErrorMsg(userErr?.message ?? "No user found.");
      return;
    }
    if (!weekStart) {
      setErrorMsg("No active week to collect from.");
      return;
    }

    const rounded = clamp2(amount);

    const { error } = await supabase.from("bucket_collections").insert({
      user_id: uid,
      week_start: weekStart,
      bucket,
      amount: rounded,
    });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setCollectedSet((prev) => new Set([...Array.from(prev), bucket]));
  }

  async function undoCollect(bucket: string) {
    setErrorMsg(null);

    const ok = await ensureSignedIn();
    if (!ok) return;

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (userErr || !uid) {
      setErrorMsg(userErr?.message ?? "No user found.");
      return;
    }
    if (!weekStart) {
      setErrorMsg("No active week to undo from.");
      return;
    }

    const { error } = await supabase
      .from("bucket_collections")
      .delete()
      .eq("user_id", uid)
      .eq("week_start", weekStart)
      .eq("bucket", bucket);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setCollectedSet((prev) => {
      const next = new Set(prev);
      next.delete(bucket);
      return next;
    });
  }

  async function coverOverspend(targetBucket: string) {
    setErrorMsg(null);
    if (!weekStart) {
      setErrorMsg("No active week.");
      return;
    }

    const targetRow = rows.find((r) => r.category === targetBucket);
    if (!targetRow || targetRow.variance >= 0) return;

    const remainingOver = clamp2(Math.abs(targetRow.variance));

    const from = (coverSource[targetBucket] ?? "").trim();
    if (!from) {
      setErrorMsg("Choose a source bucket to cover from.");
      return;
    }
    if (from === targetBucket) {
      setErrorMsg("Source and target can’t be the same.");
      return;
    }

    const available = availableFromBucket(from);
    if (available <= 0) {
      setErrorMsg("That source bucket has no available money.");
      return;
    }

    const wantStr = (coverAmount[targetBucket] ?? "").trim();
    let amt = wantStr ? Number(wantStr) : Math.min(remainingOver, available);

    if (!Number.isFinite(amt) || amt <= 0) {
      setErrorMsg("Enter a valid cover amount.");
      return;
    }

    amt = clamp2(Math.min(amt, remainingOver, available));
    setCoveringBucket(targetBucket);

    const ok = await ensureSignedIn();
    if (!ok) {
      setCoveringBucket(null);
      return;
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (userErr || !uid) {
      setErrorMsg(userErr?.message ?? "No user found.");
      setCoveringBucket(null);
      return;
    }

    const { error } = await supabase.from("bucket_transfers").insert({
      user_id: uid,
      week_start: weekStart,
      from_bucket: from,
      to_bucket: targetBucket,
      amount: amt,
    });

    if (error) {
      setErrorMsg(error.message);
      setCoveringBucket(null);
      return;
    }

    setCoverAmount((prev) => ({ ...prev, [targetBucket]: "" }));
    await loadWeekAll(weekStart);
    setCoveringBucket(null);
  }

  /** ---------- Effects ---------- */
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/login");
        router.refresh();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const loadedPrefs = await loadPreferencesReturn();
      setPrefs(loadedPrefs);

      const ws = mostRecentDowISO(new Date(), loadedPrefs.paydayDow);
      setViewWeekInput(ws);
      setNewWeekStartDate(ws);

      await loadWeekAll(ws);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  /** ---------- UI ---------- */
  return (
    <main
      style={{
        width: "100%",
        maxWidth: "100%",
        background: THEME.bg,
        minHeight: "100vh",
        color: THEME.text,
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "2rem" }}>
        {/* Header */}
        <header style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 36, fontWeight: 950, letterSpacing: "-0.02em" }}>
              🌸 Dashboard
            </h1>

            <div
              style={{
                display: "inline-flex",
                gap: 8,
                alignItems: "center",
                padding: "0.5rem 0.8rem",
                borderRadius: 999,
                background: `linear-gradient(135deg, ${THEME.soft1} 0%, ${THEME.soft2} 100%)`,
                border: `1px solid ${THEME.border}`,
                boxShadow: THEME.shadowSoft,
                fontWeight: 850,
                color: THEME.text,
              }}
            >
              💸 <span>Let’s keep it cute & on-budget.</span>
            </div>
          </div>

          <div style={{ marginTop: 8, color: THEME.muted, fontWeight: 700 }}>
            {weekStart ? (
              <span>
                Viewing week starting{" "}
                <span style={{ color: THEME.text, fontWeight: 900 }}>{weekStart}</span>{" "}
                <span style={{ color: THEME.muted }}>({dowName(prefs.paydayDow)} week)</span>
              </span>
            ) : (
              <span>No week selected.</span>
            )}
          </div>
        </header>

        {/* Top buttons */}
        <div style={{ display: "flex", gap: "0.75rem", margin: "1rem 0", flexWrap: "wrap" }}>
          <button
            {...pressHandlers()}
            onClick={() => setShowAddWeek((v) => !v)}
            style={showAddWeek ? btnSoft : btnPrimary}
          >
            {showAddWeek ? "✖ Close" : "➕ Add New Week"}
          </button>

          <button
            {...pressHandlers()}
            onClick={() =>
              weekStart ? loadWeekAll(weekStart) : loadWeekAll(mostRecentDowISO(new Date(), prefs.paydayDow))
            }
            style={btnBase}
          >
            🔄 Refresh all
          </button>
        </div>

        {errorMsg && (
          <p style={{ color: THEME.danger, fontWeight: 900, marginTop: 0 }}>Error: {errorMsg}</p>
        )}

        {/* Budget this week */}
        <div style={{ ...cardStyle, marginBottom: "1.25rem" }}>
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${THEME.soft3}, ${THEME.soft1})`,
              marginBottom: 12,
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950 }}>Budget this week</h2>
              <div style={{ marginTop: 6, color: THEME.muted, fontWeight: 700 }}>
                This is the number used to auto-build your weekly budgets.
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 22, fontWeight: 950 }}>
                ${money(Number(weeklyIncome?.amount ?? 0))}
              </div>
            </div>
          </div>
        </div>

        {/* Add new week */}
        {showAddWeek && (
          <section style={{ ...cardStyle, marginBottom: "1.25rem" }}>
            <div style={{ height: 10, borderRadius: 999, background: bucketStripBg("student loans"), marginBottom: 12 }} />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950 }}>New week budget</h2>
            <p style={{ marginTop: 8, marginBottom: 0, color: THEME.muted, fontWeight: 650 }}>
              Pick the week start date and enter the income. I’ll auto-allocate it to your 5 categories.
            </p>

            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "end", marginTop: 12 }}>
              <label style={{ fontWeight: 850 }}>
                Week start (calendar)
                <input
                  type="date"
                  value={newWeekStartDate}
                  onChange={(e) => setNewWeekStartDate(e.target.value)}
                  style={{ ...inputStyle, minWidth: 220, marginTop: 6 }}
                />
              </label>

              <label style={{ fontWeight: 850 }}>
                Budget this week
                <input
                  inputMode="decimal"
                  placeholder="235.57"
                  value={incomeInput}
                  onChange={(e) => setIncomeInput(e.target.value)}
                  style={{ ...inputStyle, minWidth: 220, marginTop: 6 }}
                />
              </label>

              <button
                {...pressHandlers()}
                onClick={addNewWeekFromIncome}
                disabled={addingWeek}
                style={{ ...btnPrimary, opacity: addingWeek ? 0.7 : 1 }}
              >
                {addingWeek ? "Adding..." : "Create budgets"}
              </button>
            </div>
          </section>
        )}

        {/* Unmapped categories (legacy only) */}
        {weekStart && unmappedCategories.length > 0 && (
          <div style={{ ...cardStyle, marginBottom: "1rem" }}>
            <div style={{ height: 10, borderRadius: 999, background: bucketStripBg("wants"), marginBottom: 12 }} />
            <div style={{ fontWeight: 950 }}>Unmapped categories 🧩</div>
            <div style={{ color: THEME.muted, fontWeight: 650, marginTop: 6 }}>
              Assign these so they count toward the weekly buckets.
            </div>

            <div style={{ display: "grid", gap: "0.5rem", marginTop: 12 }}>
              {unmappedCategories.map((raw) => (
                <div key={raw} style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ minWidth: 180, fontWeight: 850 }}>{raw}</span>
                  <select
                    defaultValue=""
                    onChange={(e) => saveMapping(raw, e.target.value)}
                    style={{ ...selectStyle, padding: "0.45rem 0.6rem" }}
                  >
                    <option value="" disabled>
                      Choose bucket…
                    </option>
                    {BUCKETS.map((b) => (
                      <option key={b} value={b}>
                        {getBucketIcon(themeName, b)} {b}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bucket cards */}
        <section style={{ marginTop: "1rem" }}>
          <h2 style={{ marginBottom: "0.75rem", fontSize: 18, fontWeight: 950 }}>
            {weekStart ? `Budgeted vs Actual (Week of ${weekStart})` : "No weekly budgets yet"}
          </h2>

          {loading ? (
            <p style={{ color: THEME.muted, fontWeight: 700 }}>Loading…</p>
          ) : !weekStart ? (
            <div style={cardStyle}>
              <div style={{ height: 10, borderRadius: 999, background: bucketStripBg("expenses"), marginBottom: 12 }} />
              <div style={{ fontWeight: 900 }}>No week selected</div>
              <div style={{ color: THEME.muted, fontWeight: 650, marginTop: 6 }}>Pick a week at the bottom.</div>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gap: "0.9rem" }}>
                {rows.map((r) => {
                  const isOpen = openBucket === r.category;
                  const isAdding = activeAddBucket === r.category;
                  const list = itemsByBucket[r.category] ?? [];
                  const over = r.variance < 0;

                  const collected = collectedSet.has(r.category);
                  const canCollect = r.variance > 0;

                  const coverOptions = BUCKETS.filter((b) => b !== r.category && availableFromBucket(b) > 0);

                  return (
                    <div key={r.category} style={{ ...cardStyle, padding: "1rem" }}>
                      <div style={{ height: 10, borderRadius: 999, background: bucketStripBg(r.category), marginBottom: 12 }} />

                      {/* header */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "52px 72px 1fr minmax(240px, 340px)",
                          gap: "0.75rem",
                          alignItems: "center",
                        }}
                      >
                        <button
                          {...pressHandlers()}
                          onClick={() => {
                            if (!weekStart) return;

                            setActiveAddBucket(r.category);
                            setOpenBucket(r.category);
                            setEditingTxId(null);

                            setTxType("expense");
                            setTxAmount("");
                            setTxRawCategory("");
                            setTxDescription("");
                            setTxDate(weekStart);
                          }}
                          title="Add transaction"
                          style={{ ...btnSoft, height: 44, width: 52, padding: 0, borderRadius: 14, fontSize: 22 }}
                        >
                          +
                        </button>

                        <button
                          {...pressHandlers()}
                          onClick={() => {
                            setOpenBucket(r.category);
                            setEditBucket(editBucket === r.category ? null : r.category);
                            setEditingTxId(null);
                          }}
                          title="Edit transactions in this category"
                          style={{ ...btnBase, height: 44, borderRadius: 14, padding: "0.55rem 0.75rem" }}
                        >
                          {editBucket === r.category ? "done" : "edit"}
                        </button>

                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 950, fontSize: 16, textTransform: "capitalize" }}>
                            {getBucketIcon(themeName, r.category)} {r.category}
                          </div>

                          <div style={{ fontSize: 14, color: THEME.muted, fontWeight: 700, marginTop: 4 }}>
                            Budgeted:{" "}
                            <span style={{ fontWeight: 900, color: THEME.text }}>${money(r.budgeted)}</span> • Spent:{" "}
                            <span style={{ fontWeight: 900, color: THEME.text }}>${money(r.spent)}</span> •{" "}
                            <span style={{ fontWeight: 950, color: over ? THEME.danger : THEME.text }}>
                              {over ? "Over" : "Under"}: ${money(Math.abs(r.variance))}
                            </span>
                          </div>

                          {/* Cover overspend */}
                          {over && (
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                              <div style={{ fontWeight: 850, color: THEME.muted }}>💸 Cover overspend:</div>

                              <select
                                value={coverSource[r.category] ?? ""}
                                onChange={(e) => setCoverSource((prev) => ({ ...prev, [r.category]: e.target.value }))}
                                style={{ ...selectStyle, padding: "0.45rem 0.6rem", minWidth: 260 }}
                              >
                                <option value="">Choose source…</option>
                                {coverOptions.map((b) => (
                                  <option key={b} value={b}>
                                    {getBucketIcon(themeName, b)} {b} (available ${money(availableFromBucket(b))})
                                  </option>
                                ))}
                              </select>

                              <input
                                inputMode="decimal"
                                placeholder="amount (optional)"
                                value={coverAmount[r.category] ?? ""}
                                onChange={(e) => setCoverAmount((prev) => ({ ...prev, [r.category]: e.target.value }))}
                                style={{ ...inputStyle, minWidth: 160 }}
                              />

                              <button
                                {...pressHandlers()}
                                onClick={() => coverOverspend(r.category)}
                                disabled={coveringBucket === r.category || coverOptions.length === 0}
                                style={{
                                  ...btnPrimary,
                                  opacity: coveringBucket === r.category || coverOptions.length === 0 ? 0.6 : 1,
                                  borderRadius: 14,
                                }}
                                title={coverOptions.length === 0 ? "No other buckets have available money." : "Transfer money to cover the overspend"}
                              >
                                {coveringBucket === r.category ? "Covering..." : "Cover"}
                              </button>
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <button
                            {...pressHandlers()}
                            onClick={() => setOpenBucket(isOpen ? null : r.category)}
                            style={{ ...btnBase, height: 44, borderRadius: 14, padding: "0.55rem 0.75rem", minWidth: 120, whiteSpace: "nowrap" }}
                          >
                            {isOpen ? "Hide" : "Show"} ({list.length})
                          </button>

                          {!collected ? (
                            <button
                              {...pressHandlers()}
                              onClick={() => collectBucket(r.category, r.variance)}
                              disabled={!canCollect}
                              style={{
                                ...btnPrimary,
                                height: 44,
                                borderRadius: 14,
                                padding: "0.55rem 0.75rem",
                                minWidth: 120,
                                whiteSpace: "nowrap",
                                opacity: !canCollect ? 0.55 : 1,
                                cursor: !canCollect ? "not-allowed" : "pointer",
                              }}
                              title={!canCollect ? "Nothing to collect (you’re not under budget)" : "Collect leftover for this week"}
                            >
                              Collect
                            </button>
                          ) : (
                            <button
                              {...pressHandlers()}
                              onClick={() => undoCollect(r.category)}
                              style={{
                                ...btnBase,
                                height: 44,
                                borderRadius: 14,
                                padding: "0.55rem 0.75rem",
                                minWidth: 120,
                                whiteSpace: "nowrap",
                                background: `linear-gradient(135deg, ${THEME.peachSoft} 0%, ${THEME.pinkSoft} 100%)`,
                              }}
                              title="Undo this collection"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                      </div>

                      {/* inline add form */}
                      {isAdding && (
                        <form
                          onSubmit={(e) => addTransactionForBucket(r.category, e)}
                          style={{
                            marginTop: 14,
                            display: "grid",
                            gap: 12,
                            borderTop: `1px solid ${THEME.border}`,
                            paddingTop: 14,
                          }}
                        >
                          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                            <label style={{ fontWeight: 850 }}>
                              Date
                              <input
                                type="date"
                                value={txDate}
                                onChange={(e) => setTxDate(e.target.value)}
                                style={{ ...inputStyle, marginTop: 6 }}
                              />
                            </label>

                            <label style={{ fontWeight: 850 }}>
                              Type
                              <select
                                value={txType}
                                onChange={(e) => setTxType(e.target.value as "expense" | "income")}
                                style={{ ...selectStyle, marginTop: 6 }}
                              >
                                <option value="expense">Expense</option>
                                <option value="income">Income</option>
                              </select>
                            </label>

                            <label style={{ fontWeight: 850 }}>
                              Amount
                              <input
                                inputMode="decimal"
                                placeholder="12.34"
                                value={txAmount}
                                onChange={(e) => setTxAmount(e.target.value)}
                                style={{ ...inputStyle, marginTop: 6 }}
                              />
                            </label>
                          </div>

                          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                            <label style={{ flex: 1, minWidth: 240, fontWeight: 850 }}>
                              Category name
                              <input
                                placeholder="Crumbl, Gas, Rent…"
                                value={txRawCategory}
                                onChange={(e) => setTxRawCategory(e.target.value)}
                                style={{ ...inputStyle, width: "100%", marginTop: 6 }}
                              />
                            </label>

                            <label style={{ flex: 2, minWidth: 260, fontWeight: 850 }}>
                              Description (optional)
                              <input
                                placeholder="notes…"
                                value={txDescription}
                                onChange={(e) => setTxDescription(e.target.value)}
                                style={{ ...inputStyle, width: "100%", marginTop: 6 }}
                              />
                            </label>
                          </div>

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button
                              {...pressHandlers()}
                              type="submit"
                              disabled={addingTx}
                              style={{ ...btnPrimary, opacity: addingTx ? 0.7 : 1 }}
                            >
                              {addingTx ? "Adding..." : `Add to ${r.category}`}
                            </button>

                            <button
                              {...pressHandlers()}
                              type="button"
                              onClick={() => setActiveAddBucket(null)}
                              disabled={addingTx}
                              style={{ ...btnBase, opacity: addingTx ? 0.7 : 1 }}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      {/* dropdown list */}
                      {isOpen && (
                        <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                          {list.length === 0 ? (
                            <div style={{ color: THEME.muted, fontWeight: 700 }}>No transactions yet ✨</div>
                          ) : (
                            list.map((item) => {
                              // ---------- TRANSACTION ----------
                              if (item.kind === "tx") {
                                const t = item.tx;
                                const isEditingThis = editingTxId === t.id;
                                const typeFromAmount: "expense" | "income" = t.amount < 0 ? "expense" : "income";
                                const parsed = splitStoredCategory(t.category);

                                return (
                                  <div
                                    key={t.id}
                                    style={{
                                      borderRadius: 16,
                                      padding: "0.7rem 0.8rem",
                                      background: `linear-gradient(135deg, ${THEME.lavenderSoft} 0%, ${THEME.mintSoft} 100%)`,
                                      border: `1px solid ${THEME.border}`,
                                      boxShadow: THEME.txCardShadow,
                                    }}
                                  >
                                    {!isEditingThis ? (
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                                        <div style={{ minWidth: 220 }}>
                                          <div style={{ fontWeight: 950 }}>
                                            {parsed.raw}{" "}
                                            <span style={{ fontWeight: 700, color: THEME.muted }}>• {t.date}</span>
                                          </div>
                                          {t.description && (
                                            <div style={{ color: THEME.muted, fontWeight: 650, marginTop: 2 }}>
                                              {t.description}
                                            </div>
                                          )}
                                        </div>

                                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                          <div style={{ fontWeight: 950, color: t.amount < 0 ? THEME.danger : THEME.text, whiteSpace: "nowrap" }}>
                                            {t.amount < 0 ? "-" : ""}${money(Math.abs(t.amount))}
                                          </div>

                                          {editBucket === r.category && (
                                            <>
                                              <button
                                                {...pressHandlers()}
                                                onClick={() => {
                                                  setEditingTxId(t.id);
                                                  setEditDate(t.date);
                                                  setEditType(typeFromAmount);
                                                  setEditAmount(String(Math.abs(t.amount)));
                                                  setEditRawCategory(parsed.raw);
                                                  setEditDescription(t.description ?? "");
                                                }}
                                                style={btnBase}
                                              >
                                                Edit
                                              </button>

                                              <button
                                                {...pressHandlers()}
                                                onClick={() => deleteTransaction(t.id)}
                                                style={{ ...btnBase, color: THEME.danger }}
                                                title="Delete transaction"
                                              >
                                                Del
                                              </button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    ) : (
                                      <div style={{ display: "grid", gap: 10 }}>
                                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                          <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={{ ...inputStyle, minWidth: 170 }} />
                                          <select value={editType} onChange={(e) => setEditType(e.target.value as "expense" | "income")} style={{ ...selectStyle, minWidth: 150 }}>
                                            <option value="expense">Expense</option>
                                            <option value="income">Income</option>
                                          </select>
                                          <input value={editAmount} onChange={(e) => setEditAmount(e.target.value)} placeholder="Amount" style={{ ...inputStyle, minWidth: 140 }} />
                                          <input value={editRawCategory} onChange={(e) => setEditRawCategory(e.target.value)} placeholder="Category name" style={{ ...inputStyle, minWidth: 200 }} />
                                        </div>

                                        <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Description (optional)" style={{ ...inputStyle, minWidth: 240 }} />

                                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                          <button
                                            {...pressHandlers()}
                                            type="button"
                                            onClick={() => updateTransaction(t)}
                                            disabled={savingEdit}
                                            style={{ ...btnPrimary, opacity: savingEdit ? 0.7 : 1 }}
                                          >
                                            {savingEdit ? "Saving..." : "Save"}
                                          </button>

                                          <button
                                            {...pressHandlers()}
                                            type="button"
                                            onClick={() => setEditingTxId(null)}
                                            disabled={savingEdit}
                                            style={{ ...btnBase, opacity: savingEdit ? 0.7 : 1 }}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              }

                              // ---------- TRANSFER ----------
                              const tr = item.tr;
                              const isOut = item.kind === "transfer_out";
                              const amount = Number(tr.amount);
                              const title = isOut ? `Transfer to ${tr.to_bucket}` : `Transfer from ${tr.from_bucket}`;

                              return (
                                <div
                                  key={`tr-${tr.id}-${item.kind}`}
                                  style={{
                                    borderRadius: 16,
                                    padding: "0.7rem 0.8rem",
                                    background: `linear-gradient(135deg, ${THEME.pinkSoft} 0%, ${THEME.lavenderSoft} 100%)`,
                                    border: `1px solid ${THEME.border}`,
                                    boxShadow: THEME.txCardShadow,
                                    opacity: 0.98,
                                  }}
                                >
                                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                                    <div style={{ minWidth: 220 }}>
                                      <div style={{ fontWeight: 950 }}>
                                        {isOut ? "🔁 Transfer out" : "✨ Transfer in"}{" "}
                                        <span style={{ fontWeight: 700, color: THEME.muted }}>
                                          • {tr.created_at?.slice(0, 10)}
                                        </span>
                                      </div>
                                      <div style={{ color: THEME.muted, fontWeight: 700, marginTop: 2 }}>{title}</div>
                                    </div>

                                    <div style={{ fontWeight: 950, color: isOut ? THEME.danger : THEME.text, whiteSpace: "nowrap" }}>
                                      {isOut ? "-" : "+"}${money(amount)}
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div style={{ ...cardStyle, marginTop: 16 }}>
                <div style={{ height: 10, borderRadius: 999, background: `linear-gradient(90deg, ${THEME.mintSoft}, ${THEME.pinkSoft})`, marginBottom: 12 }} />
                <div style={{ fontWeight: 950, fontSize: 16 }}>Weekly totals ✨</div>
                <div style={{ color: THEME.muted, fontWeight: 750, marginTop: 6 }}>
                  Budgeted: <span style={{ fontWeight: 950, color: THEME.text }}>${money(totals.totalBudgeted)}</span> • Spent:{" "}
                  <span style={{ fontWeight: 950, color: THEME.text }}>${money(totals.totalSpent)}</span> •{" "}
                  <span style={{ fontWeight: 950, color: totals.totalVariance < 0 ? THEME.danger : THEME.text }}>
                    {totals.totalVariance < 0 ? "Over" : "Under"}: ${money(Math.abs(totals.totalVariance))}
                  </span>
                </div>
              </div>
            </>
          )}
        </section>

        {/* View week selector at bottom */}
        <section style={{ ...cardStyle, marginTop: 22 }}>
          <div style={{ height: 10, borderRadius: 999, background: bucketStripBg("expenses"), marginBottom: 12 }} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 950 }}>View a week</h2>
          <div style={{ marginTop: 8, color: THEME.muted, fontWeight: 700 }}>
            Pick the week start date to view past weeks (and add transactions to that week).
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", marginTop: 12 }}>
            <label style={{ fontWeight: 850 }}>
              Week start
              <input
                type="date"
                value={viewWeekInput}
                onChange={(e) => setViewWeekInput(e.target.value)}
                style={{ ...inputStyle, minWidth: 220, marginTop: 6 }}
              />
            </label>

            <button
              {...pressHandlers()}
              onClick={async () => {
                if (!viewWeekInput) return;
                setActiveAddBucket(null);
                setEditingTxId(null);
                await loadWeekAll(viewWeekInput);
              }}
              style={btnPrimary}
            >
              View week
            </button>

            <button
              {...pressHandlers()}
              onClick={async () => {
                const ws = mostRecentDowISO(new Date(), prefs.paydayDow);
                setViewWeekInput(ws);
                setActiveAddBucket(null);
                setEditingTxId(null);
                await loadWeekAll(ws);
              }}
              style={btnBase}
            >
              Today’s week
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
