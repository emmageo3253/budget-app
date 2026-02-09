"use client";

import { useMemo, useState } from "react";
import { collectLeftover, undoCollect } from "@/lib/collections";

type Props = {
  weekId: string;
  category: string;
  remaining: number;
  // Use this to refresh your UI after collect/undo (refetch week, rerender categories, etc.)
  onChanged?: () => void;
};

export default function CollectButton({ weekId, category, remaining, onChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [isCollected, setIsCollected] = useState(false);

  const disabled = useMemo(() => loading || (!isCollected && remaining <= 0), [loading, isCollected, remaining]);

  async function onClick() {
    if (disabled) return;

    try {
      setLoading(true);

      if (!isCollected) {
        await collectLeftover({ weekId, category, amount: remaining });

        // ✅ TODO: set remaining=0 in YOUR category table here (or do it in the parent handler)
        // If your parent already updates remaining locally, you can skip the DB update.
        //
        // Example (YOU MUST CHANGE TABLE/COLUMNS):
        // await supabase.from("budget_categories")
        //  .update({ remaining: 0 })
        //  .eq("week_id", weekId)
        //  .eq("category", category);

        setIsCollected(true);
      } else {
        const undone = await undoCollect({ weekId, category });

        // ✅ TODO: restore remaining in YOUR category table using undone.amount
        // Example:
        // await supabase.from("budget_categories")
        //  .update({ remaining: undone?.amount ?? 0 })
        //  .eq("week_id", weekId)
        //  .eq("category", category);

        setIsCollected(false);
      }

      onChanged?.();
    } catch (e) {
      console.error(e);
      alert("Collect failed. Check console + Supabase table/policies.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 14px",
        borderRadius: 14,
        border: "1px solid rgba(0,0,0,0.10)",
        background: disabled ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.75)",
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        minWidth: 96,
      }}
      title={isCollected ? "Undo collection" : "Collect leftover"}
    >
      {loading ? "..." : isCollected ? "Undo" : "Collect"}
    </button>
  );
}
