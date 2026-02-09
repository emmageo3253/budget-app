"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export type ThemeId = "soft" | "cool" | "dark" | "mint" | "neutral";

type ThemeContextValue = {
  theme: ThemeId;
  setTheme: (t: ThemeId) => Promise<void>;
  isLoading: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

const THEME_STORAGE_KEY = "budgetapp_theme";

function isThemeId(x: unknown): x is ThemeId {
  return x === "soft" || x === "cool" || x === "dark" || x === "mint" || x === "neutral";
}

function readThemeFromStorage(): ThemeId | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeId(raw) ? raw : null;
}

function writeThemeToStorage(theme: ThemeId) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

/**
 * Theme token map:
 * IMPORTANT:
 * - Your pages use: --bg, --card, --border, --text, --muted, --shadow, --shadowSoft
 * - And accents: --pinkSoft, --lavenderSoft, --mintSoft, --peachSoft
 *
 * Key idea: "mint" must NOT reuse pink/lavender soft tokens, or the UI will look pink.
 */
const THEMES: Record<ThemeId, Record<string, string>> = {
  soft: {
    "--bg": "#FFF7FB",
    "--card": "#FFFFFF",
    "--border": "#F1D3E3",
    "--text": "#2B2B2B",
    "--muted": "#6B5B66",
    "--shadow": "0 14px 30px rgba(255, 125, 182, 0.12)",
    "--shadowSoft": "0 10px 22px rgba(0,0,0,0.06)",

    "--pinkSoft": "#FFE1EF",
    "--lavenderSoft": "#EEE9FF",
    "--mintSoft": "#E8FBF6",
    "--peachSoft": "#FFF0E8",
    "--danger": "#DC2626", // nice modern red (or "crimson")
  },

  mint: {
    "--bg": "#F4FFFB",
    "--card": "#FFFFFF",
    "--border": "#BFEFE0",
    "--text": "#173A33",
    "--muted": "#3F6B61",
    "--shadow": "0 14px 30px rgba(32, 201, 151, 0.12)",
    "--shadowSoft": "0 10px 22px rgba(0,0,0,0.06)",
    "--danger": "#DC2626", // nice modern red (or "crimson")


    // ✅ keep names for compatibility, but make them mint-family
    "--pinkSoft": "#D9FFF3",
    "--lavenderSoft": "#E8FFF8",
    "--mintSoft": "#CFFBEB",
    "--peachSoft": "#E9FFF7",
  },

  cool: {
    "--bg": "#F6FAFF",
    "--card": "#FFFFFF",
    "--border": "#CFE0FF",
    "--text": "#1F2A44",
    "--muted": "#51607A",
    "--shadow": "0 14px 30px rgba(76, 136, 255, 0.12)",
    "--shadowSoft": "0 10px 22px rgba(0,0,0,0.06)",

    "--pinkSoft": "#E6F0FF",
    "--lavenderSoft": "#EEF3FF",
    "--mintSoft": "#EAF6FF",
    "--peachSoft": "#F2F7FF",
    "--danger": "#DC2626", // nice modern red (or "crimson")

  },

  neutral: {
    "--bg": "#FAFAFB",
    "--card": "#FFFFFF",
    "--border": "#E6E6EA",
    "--text": "#1F1F22",
    "--muted": "#60606B",
    "--shadow": "0 14px 30px rgba(0,0,0,0.08)",
    "--shadowSoft": "0 10px 22px rgba(0,0,0,0.06)",

    "--pinkSoft": "#F2F2F6",
    "--lavenderSoft": "#F4F4F8",
    "--mintSoft": "#F1F6F4",
    "--peachSoft": "#F6F3F1",
    "--danger": "#DC2626", // nice modern red (or "crimson")

  },

  dark: {
    "--bg": "#0E1116",
    "--card": "#141A22",
    "--border": "#263042",
    "--text": "#E9EDF5",
    "--muted": "#A8B2C5",
    "--shadow": "0 18px 40px rgba(0,0,0,0.45)",
    "--shadowSoft": "0 12px 24px rgba(0,0,0,0.35)",

    "--pinkSoft": "#1B2330",
    "--lavenderSoft": "#172031",
    "--mintSoft": "#132428",
    "--peachSoft": "#1D201A",
    "--danger": "#DC2626", // nice modern red (or "crimson")

  },
};

function applyThemeToDom(theme: ThemeId) {
  // Apply identifiers
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;

  // ✅ Apply CSS variables
  const tokens = THEMES[theme] ?? THEMES.soft;
  const rootStyle = document.documentElement.style;

  for (const [k, v] of Object.entries(tokens)) {
    rootStyle.setProperty(k, v);
  }

  window.dispatchEvent(new Event("themechange"));
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  // initialize from localStorage immediately (prevents flash)
  const [theme, setThemeState] = useState<ThemeId>(() => readThemeFromStorage() ?? "soft");
  const [isLoading, setIsLoading] = useState(true);

  // ✅ Always keep DOM in sync with current theme
  useEffect(() => {
    applyThemeToDom(theme);
    writeThemeToStorage(theme);
  }, [theme]);

  // On mount (and on auth changes): if signed in, load theme from DB; else keep local theme
  useEffect(() => {
    let alive = true;

    async function loadTheme() {
      setIsLoading(true);

      const local = readThemeFromStorage() ?? "soft";

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;

      // if not signed in, keep local choice
      if (!user) {
        if (!alive) return;
        setThemeState(local);
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("user_preferences")
        .select("theme")
        .eq("user_id", user.id)
        .maybeSingle();

      const candidate = data?.theme;
      const dbTheme = isThemeId(candidate) ? candidate : local;

      if (!alive) return;
      setThemeState(dbTheme);
      writeThemeToStorage(dbTheme);
      setIsLoading(false);

      // if row missing, upsert once
      if (!data && !error) {
        await supabase.from("user_preferences").upsert(
          { user_id: user.id, theme: dbTheme },
          { onConflict: "user_id" }
        );
      }
    }

    loadTheme();

    const { data: sub } = supabase.auth.onAuthStateChange(() => loadTheme());

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      isLoading,
      setTheme: async (t: ThemeId) => {
        setThemeState(t);
        writeThemeToStorage(t);

        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user) return;

        await supabase.from("user_preferences").upsert(
          { user_id: user.id, theme: t },
          { onConflict: "user_id" }
        );
      },
    }),
    [theme, isLoading]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
