"use client";

import React from "react";
import { useTheme, ThemeId } from "./ThemeProvider";

const OPTIONS: { id: ThemeId; label: string; emoji: string; hint: string }[] = [
  { id: "soft", label: "Soft", emoji: "🌸", hint: "Pastel & warm" },
  { id: "cool", label: "Cool", emoji: "❄️", hint: "Clean blue" },
  { id: "dark", label: "Dark", emoji: "🌙", hint: "Low-light mode" },
  { id: "mint", label: "Mint", emoji: "🌿", hint: "Fresh green" },
];

export default function ThemePickerCard() {
  const { theme, setTheme, isLoading } = useTheme();

  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 18,
        padding: 16,
        boxShadow: "var(--shadowSoft)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <div style={{ fontWeight: 800, color: "var(--text)" }}>Theme</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            Pick a look — your whole app updates instantly.
          </div>
        </div>

        <div
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid var(--border)",
            color: "var(--muted)",
            fontSize: 12,
          }}
        >
          {isLoading ? "Loading…" : `Current: ${theme}`}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 14 }}>
        {OPTIONS.map((o) => {
          const active = theme === o.id;
          return (
            <button
              key={o.id}
              onClick={() => setTheme(o.id)}
              style={{
                textAlign: "left",
                padding: 12,
                borderRadius: 14,
                border: active ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: active ? "var(--soft1)" : "var(--card)",
                boxShadow: active ? "var(--shadowSoft)" : "none",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 800, color: "var(--text)" }}>
                  {o.emoji} {o.label}
                </div>
                {active ? (
                  <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 800 }}>Selected</span>
                ) : null}
              </div>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--muted)" }}>{o.hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
