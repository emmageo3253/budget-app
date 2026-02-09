"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/**
 * Neutral (but not boring) login screen:
 * - Uses CSS variables only (plays nice with your theme switcher)
 * - Soft background + subtle gradient accents
 * - Clean card UI + better states
 *
 * Add these CSS variables somewhere global (globals.css), or already have equivalents:
 * :root {
 *   --login-bg-start: #f7f7fb;
 *   --login-bg-end: #ffffff;
 *   --login-card-bg: rgba(255,255,255,0.88);
 *   --login-border: rgba(0,0,0,0.07);
 *   --login-shadow: 0 18px 40px rgba(0,0,0,0.10);
 *   --login-text-main: #1f2937;
 *   --login-text-muted: #6b7280;
 *   --login-accent-start: #e9e7ff;
 *   --login-accent-end: #ffe3f1;
 *   --login-btn-start: #111827;
 *   --login-btn-end: #374151;
 *   --login-btn-text: #ffffff;
 *   --focus-ring: rgba(99,102,241,0.35);
 * }
 */

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // If already signed in, bounce out of login
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data.session) {
        router.replace("/");
        router.refresh();
      }
    });
    return () => {
      alive = false;
    };
  }, [router]);

  async function handleSignUp() {
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signUp({ email, password });

    setLoading(false);
    setMessage(
      error
        ? `Sign up failed: ${error.message}`
        : "Sign up successful! If email confirmation is on, check your inbox."
    );
  }

async function handleSignIn() {
  setLoading(true);
  setMessage(null);

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setLoading(false);
    setMessage(`Sign in failed: ${error.message}`);
    return;
  }

  // ✅ wait for session to be available (prevents "needs refresh" bug)
  const start = Date.now();
  while (Date.now() - start < 2000) {
    const { data } = await supabase.auth.getSession();
    if (data.session) break;
    await new Promise((r) => setTimeout(r, 80));
  }

  setLoading(false);
  setMessage("Signed in!");
  router.replace("/");   // go to home
  router.refresh();      // ensure UI updates
}

  const disabled = loading || !email || !password;

  return (
    <main
      data-theme="login"
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2.25rem 1.25rem",
        background:
          "linear-gradient(180deg, var(--login-bg-start), var(--login-bg-end))",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* subtle background accents */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(900px 500px at 15% 15%, var(--login-accent-start), transparent 60%), radial-gradient(900px 500px at 85% 25%, var(--login-accent-end), transparent 62%)",
          opacity: 0.9,
        }}
      />

      <section
        style={{
          width: "100%",
          maxWidth: 440,
          position: "relative",
          zIndex: 1,
          borderRadius: 22,
          border: "1px solid var(--login-border)",
          background: "var(--login-card-bg)",
          boxShadow: "var(--login-shadow)",
          backdropFilter: "blur(10px)",
          padding: "1.35rem 1.25rem",
        }}
      >
        <div style={{ display: "grid", gap: 6, marginBottom: "1.1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              aria-hidden
              style={{
                width: 38,
                height: 38,
                borderRadius: 14,
                background:
                  "linear-gradient(135deg, var(--login-accent-end), var(--login-accent-start))",
                boxShadow: "0 12px 26px rgba(0,0,0,0.08)",
                display: "grid",
                placeItems: "center",
                fontWeight: 900,
                color: "var(--login-text-main)",
              }}
            >
              ✦
            </div>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 22,
                  lineHeight: 1.15,
                  color: "var(--login-text-main)",
                  letterSpacing: -0.2,
                }}
              >
                Welcome back
              </h1>
              <p
                style={{
                  margin: 0,
                  marginTop: 2,
                  fontSize: 13,
                  color: "var(--login-text-muted)",
                  fontWeight: 600,
                }}
              >
                Sign in to keep budgeting (and saving) on track.
              </p>
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!disabled) handleSignIn();
          }}
          style={{ display: "grid", gap: 12 }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--login-text-main)" }}>
              Email
            </span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              autoComplete="email"
              inputMode="email"
              style={{
                width: "100%",
                padding: "0.7rem 0.85rem",
                borderRadius: 14,
                border: "1px solid var(--login-border)",
                background: "rgba(255,255,255,0.75)",
                color: "var(--login-text-main)",
                outline: "none",
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = "0 0 0 4px var(--focus-ring)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--login-text-main)" }}>
              Password
            </span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              style={{
                width: "100%",
                padding: "0.7rem 0.85rem",
                borderRadius: 14,
                border: "1px solid var(--login-border)",
                background: "rgba(255,255,255,0.75)",
                color: "var(--login-text-main)",
                outline: "none",
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = "0 0 0 4px var(--focus-ring)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </label>

          <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
            <button
              type="submit"
              disabled={disabled}
              style={{
                flex: 1,
                minWidth: 160,
                borderRadius: 999,
                padding: "0.7rem 1rem",
                border: "1px solid rgba(0,0,0,0.08)",
                background:
                  "linear-gradient(135deg, var(--login-btn-start), var(--login-btn-end))",
                color: "var(--login-btn-text)",
                fontWeight: 900,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.7 : 1,
                transition: "transform 120ms ease, filter 120ms ease",
              }}
              onMouseDown={(e) => {
                if (disabled) return;
                e.currentTarget.style.transform = "scale(0.98)";
                e.currentTarget.style.filter = "brightness(0.98)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.filter = "none";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.filter = "none";
              }}
            >
              {loading ? "Working..." : "Sign in"}
            </button>

            <button
              type="button"
              onClick={handleSignUp}
              disabled={disabled}
              style={{
                flex: 1,
                minWidth: 160,
                borderRadius: 999,
                padding: "0.7rem 1rem",
                border: "1px solid var(--login-border)",
                background: "transparent",
                color: "var(--login-text-main)",
                fontWeight: 900,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.7 : 1,
                transition: "transform 120ms ease, filter 120ms ease, background 120ms ease",
              }}
              onMouseDown={(e) => {
                if (disabled) return;
                e.currentTarget.style.transform = "scale(0.98)";
                e.currentTarget.style.filter = "brightness(0.98)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.filter = "none";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "scale(1)";
                e.currentTarget.style.filter = "none";
              }}
            >
              {loading ? "Working..." : "Sign up"}
            </button>
          </div>

          {message && (
            <p
              style={{
                margin: 0,
                marginTop: 10,
                padding: "0.75rem 0.9rem",
                borderRadius: 16,
                border: "1px solid var(--login-border)",
                background: "rgba(255,255,255,0.65)",
                color: "var(--login-text-main)",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {message}
            </p>
          )}

          <p
            style={{
              margin: 0,
              marginTop: 6,
              fontSize: 12,
              color: "var(--login-text-muted)",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            Tip: you can make a demo account email/password, and each user only sees their own data (RLS).
          </p>
        </form>
      </section>
    </main>
  );
}
