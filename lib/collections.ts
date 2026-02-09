import { supabase } from "@/lib/supabaseClient";

export type Bucket = "savings" | "student_loans" | "emergency" | "extra_money";

export function bucketForCategory(category: string): Bucket {
  const c = category.toLowerCase();
  if (c.includes("student")) return "student_loans";
  if (c.includes("saving")) return "savings";
  if (c.includes("emerg")) return "emergency";
  if (c.includes("want") || c.includes("expense")) return "extra_money";
  return "extra_money";
}

export async function getUserIdOrThrow() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  const userId = data.user?.id;
  if (!userId) throw new Error("Not logged in");
  return userId;
}

/**
 * Creates a collection row and returns it.
 * You should ALSO set remaining to 0 in your category table (see TODO in your button handler).
 */
export async function collectLeftover(params: {
  weekId: string;
  category: string;
  amount: number;
}) {
  const { weekId, category, amount } = params;
  if (!amount || amount <= 0) return null;

  const userId = await getUserIdOrThrow();
  const bucket = bucketForCategory(category);

  const { data, error } = await supabase
    .from("collections")
    .insert({
      user_id: userId,
      week_id: weekId,
      category,
      bucket,
      amount,
    })
    .select("id, user_id, week_id, category, bucket, amount, created_at, undone_at")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Marks the most recent (non-undone) collection for that week+category as undone.
 * You should ALSO restore remaining in your category table (see TODO in your button handler).
 */
export async function undoCollect(params: { weekId: string; category: string }) {
  const userId = await getUserIdOrThrow();
  const { weekId, category } = params;

  // find most recent active collection
  const { data: existing, error: findErr } = await supabase
    .from("collections")
    .select("id, amount")
    .eq("user_id", userId)
    .eq("week_id", weekId)
    .eq("category", category)
    .is("undone_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (findErr) throw findErr;
  const row = existing?.[0];
  if (!row) return null;

  const { data: updated, error: updErr } = await supabase
    .from("collections")
    .update({ undone_at: new Date().toISOString() })
    .eq("id", row.id)
    .select("id, amount, undone_at")
    .single();

  if (updErr) throw updErr;
  return { ...updated, amount: row.amount };
}
