"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const THEME = {
  border: "var(--border)",
  text: "var(--text)",
  muted: "var(--muted)",
  accent: "var(--accent)",
  accentSoft: "var(--accentSoft)",
  accentSoft2: "var(--accentSoft2)",
  shadowSoft: "var(--shadowSoft)",
  navBg: "var(--navBg)",
  onPrimary: "var(--onPrimary)",
};

function pill(isActive: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "0.55rem 0.85rem",
    borderRadius: 999,
    fontWeight: 900,
    textDecoration: "none",
    border: `1px solid ${THEME.border}`,
    background: isActive ? `linear-gradient(135deg, ${THEME.accentSoft} 0%, ${THEME.accentSoft2} 100%)` : "transparent",
    color: THEME.text,
    boxShadow: isActive ? THEME.shadowSoft : "none",
    transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

const btnBase: React.CSSProperties = {
  borderRadius: 999,
  padding: "0.55rem 0.85rem",
  cursor: "pointer",
  fontWeight: 900,
  border: `1px solid ${THEME.border}`,
  background: "transparent",
  color: THEME.text,
  transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
};

const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: `linear-gradient(
  90deg,
  var(--accentStrong),
  var(--accent)
)`,

  color: THEME.onPrimary,
  border: "1px solid rgba(255,125,182,0.25)", // purely cosmetic; safe
  boxShadow: "0 14px 30px rgba(0,0,0,0.12)",
};

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const hideNav = useMemo(() => {
    const p = pathname ?? "";
    return p.startsWith("/login") || p.startsWith("/signup") || p.startsWith("/reset");
  }, [pathname]);

  useEffect(() => {
    let alive = true;

    async function syncUser() {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      setEmail(data.user?.email ?? null);
    }

    syncUser();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      syncUser();
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const pressHandlers = {
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.transform = "scale(0.98)";
      (e.currentTarget as HTMLElement).style.filter = "brightness(0.98)";
    },
    onMouseUp: (e: React.MouseEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.transform = "scale(1)";
      (e.currentTarget as HTMLElement).style.filter = "none";
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.transform = "scale(1)";
      (e.currentTarget as HTMLElement).style.filter = "none";
    },
  };

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);

    try {
      await supabase.auth.signOut();
      // ✅ Hard navigation avoids any Next “working…” loops / stale router state
      window.location.assign("/login");
    } finally {
      // in case navigation is blocked in dev, this re-enables the button
      setTimeout(() => setLoggingOut(false), 800);
    }
  }

  if (hideNav) return null;

  const isHome = pathname === "/";
  const isDash = pathname?.startsWith("/dashboard");
  const isSavings = pathname?.startsWith("/savings");

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0.85rem 1.25rem",
        borderBottom: `1px solid ${THEME.border}`,
        background: THEME.navBg,
        backdropFilter: "blur(10px)",
        // ✅ ensures nothing “invisible” steals clicks
        pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/" style={pill(!!isHome)} {...pressHandlers}>
          🏠 <span>Home</span>
        </Link>

        <Link href="/dashboard" style={pill(!!isDash)} {...pressHandlers}>
          🌸 <span>Dashboard</span>
        </Link>

        <Link href="/savings" style={pill(!!isSavings)} {...pressHandlers}>
          💗 <span>Savings</span>
        </Link>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        {email ? (
          <>
            <span style={{ opacity: 0.9, color: THEME.text, fontWeight: 700, fontSize: 13 }}>{email}</span>

            <button
              type="button"
              onClick={handleLogout}
              style={{
                ...btnPrimary,
                opacity: loggingOut ? 0.75 : 1,
                cursor: loggingOut ? "not-allowed" : "pointer",
              }}
              {...pressHandlers}
              disabled={loggingOut}
              title="Log out"
            >
              {loggingOut ? "Loading…" : "✨ Log out"}
            </button>
          </>
        ) : (
          <Link href="/login" style={pill((pathname ?? "").startsWith("/login"))} {...pressHandlers}>
            🔐 <span>Login</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
