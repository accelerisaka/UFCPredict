"use server";

import { redirect } from "next/navigation";
import {
  clearSession,
  findUserByUsername,
  getCurrentUser,
  hashPassword,
  setSession,
  usernameKey,
  validUsername,
  verifyPassword,
} from "@/lib/auth";
import { getDb, nowIso } from "@/lib/db";
import { isBettingClosed, isValidPrice, STAKE_CENTS } from "@/lib/format";
import { fetchBuyPrices, fetchListedFightMarkets, pricesForFight } from "@/lib/polymarket";
import { ensureSchedule } from "@/lib/sync";

export type AuthState = { error?: string };
export type PredictResult = { ok: true; lockedPrice?: number } | { ok: false; error: string };

function safeNext(value: FormDataEntryValue | null): string {
  const text = String(value || "");
  if (!text.startsWith("/") || text.startsWith("//") || text.includes("\\")) return "/";
  return text;
}

export async function registerAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const username = String(formData.get("username") || "").normalize("NFC").trim();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (!validUsername(username)) return { error: "用户名需要 2 到 20 位中文、字母、数字或下划线" };
  if (password.length < 6 || password.length > 72) return { error: "密码需要 6 到 72 位" };
  if (password !== confirm) return { error: "两次输入的密码不一致" };

  try {
    const result = getDb()
      .prepare("INSERT INTO users (username, username_key, password_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(username, usernameKey(username), hashPassword(password), nowIso());
    await setSession(Number(result.lastInsertRowid));
  } catch {
    return { error: "这个用户名已经有人用了" };
  }
  redirect(safeNext(formData.get("next")));
}

export async function loginAction(_state: AuthState, formData: FormData): Promise<AuthState> {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const user = findUserByUsername(username);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return { error: "用户名或密码不正确" };
  }
  await setSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/");
}

export async function forceSyncAction(): Promise<void> {
  await ensureSchedule(true);
  redirect("/");
}

type OpenFight = {
  id: number;
  status: string;
  segment_starts_at: string | null;
  red_fighter_id: number;
  blue_fighter_id: number;
};

type OpenPrediction = {
  id: number;
  fighter_id: number;
  status: string;
};

type MarketToken = {
  red_token: string | null;
  blue_token: string | null;
};

export async function placePrediction(fightId: number, fighterId: number): Promise<PredictResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "请先登录" };
  if (!Number.isInteger(fightId) || !Number.isInteger(fighterId)) return { ok: false, error: "预测无效" };

  const fight = getDb()
    .prepare(
      `SELECT id, status, segment_starts_at, red_fighter_id, blue_fighter_id
       FROM fights WHERE id = ?`,
    )
    .get(fightId) as OpenFight | undefined;
  if (!fight || fight.status === "cancelled") return { ok: false, error: "这场比赛不存在" };
  if (fighterId !== fight.red_fighter_id && fighterId !== fight.blue_fighter_id) {
    return { ok: false, error: "只能预测这场比赛的选手" };
  }

  const existing = getDb()
    .prepare("SELECT id, fighter_id, status FROM predictions WHERE user_id = ? AND fight_id = ? AND status = 'open'")
    .get(user.id, fightId) as OpenPrediction | undefined;
  if (isBettingClosed(fight.status, fight.segment_starts_at)) {
    return { ok: false, error: existing ? "比赛已开始，预测已锁定" : "比赛已开始，停止接受预测" };
  }
  if (existing) return { ok: false, error: "请先取消当前预测" };

  const names = getDb()
    .prepare(
      `SELECT fr.name AS red_name, fb.name AS blue_name
       FROM fights f
       JOIN fighters fr ON fr.id = f.red_fighter_id
       JOIN fighters fb ON fb.id = f.blue_fighter_id
       WHERE f.id = ?`,
    )
    .get(fightId) as { red_name: string; blue_name: string } | undefined;
  if (!names) return { ok: false, error: "这场比赛不存在" };
  const market = getDb().prepare("SELECT red_token, blue_token FROM markets WHERE fight_id = ?").get(fightId) as
    | MarketToken
    | undefined;
  const token = fighterId === fight.red_fighter_id ? market?.red_token : market?.blue_token;

  let price: number;
  try {
    if (token) {
      const quotes = await fetchBuyPrices([token]);
      const quote = quotes[token];
      if (!isValidPrice(quote)) return { ok: false, error: "当前价格不可用，请稍后再试" };
      price = quote;
    } else {
      const listed = await fetchListedFightMarkets();
      const page = listed.find((item) => pricesForFight(names.red_name, names.blue_name, item));
      const prices = page ? pricesForFight(names.red_name, names.blue_name, page) : null;
      const quote = prices ? (fighterId === fight.red_fighter_id ? prices.redPrice : prices.bluePrice) : null;
      if (!isValidPrice(quote)) return { ok: false, error: "这场还没有 Polymarket 盘口，暂时不能预测" };
      price = quote;
    }
  } catch {
    return { ok: false, error: "暂时拿不到 Polymarket 实时价格，请稍后再试" };
  }

  const stamp = nowIso();
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO predictions (user_id, fight_id, fighter_id, stake_cents, locked_price, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(user.id, fightId, fighterId, STAKE_CENTS, price, stamp, stamp);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) return { ok: false, error: "请先取消当前预测" };
    throw error;
  }

  if (fighterId === fight.red_fighter_id) {
    db.prepare("UPDATE markets SET red_price = ?, updated_at = ? WHERE fight_id = ?").run(price, stamp, fightId);
  } else {
    db.prepare("UPDATE markets SET blue_price = ?, updated_at = ? WHERE fight_id = ?").run(price, stamp, fightId);
  }
  return { ok: true, lockedPrice: price };
}

export async function cancelPrediction(fightId: number): Promise<PredictResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "请先登录" };
  if (!Number.isInteger(fightId)) return { ok: false, error: "预测无效" };

  const fight = getDb()
    .prepare("SELECT id, status, segment_starts_at, red_fighter_id, blue_fighter_id FROM fights WHERE id = ?")
    .get(fightId) as OpenFight | undefined;
  if (!fight) return { ok: false, error: "这场比赛不存在" };

  const existing = getDb()
    .prepare("SELECT id, fighter_id, status FROM predictions WHERE user_id = ? AND fight_id = ? AND status = 'open'")
    .get(user.id, fightId) as OpenPrediction | undefined;
  if (!existing) return { ok: false, error: "这场还没有预测" };
  if (existing.status !== "open") return { ok: false, error: "这场已经结算，不能取消" };
  if (isBettingClosed(fight.status, fight.segment_starts_at)) {
    return { ok: false, error: "比赛已开始，预测已锁定" };
  }

  const deleted = getDb()
    .prepare("DELETE FROM predictions WHERE id = ? AND user_id = ? AND status = 'open'")
    .run(existing.id, user.id);
  if (Number(deleted.changes) !== 1) return { ok: false, error: "这场预测已经不能取消" };
  return { ok: true };
}
