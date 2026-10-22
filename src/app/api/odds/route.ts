import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { refreshEventPrices } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("event");
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    return NextResponse.json({ error: "缺少赛事" }, { status: 400 });
  }

  const event = getDb().prepare("SELECT id FROM events WHERE slug = ?").get(slug) as { id: number } | undefined;
  if (!event) return NextResponse.json({ error: "没有这场赛事" }, { status: 404 });

  try {
    await refreshEventPrices(event.id);
  } catch {
    // 返回数据库里的上一口价格。
  }

  const rows = getDb()
    .prepare(
      `SELECT m.fight_id, m.red_price, m.blue_price
       FROM markets m
       JOIN fights f ON f.id = m.fight_id
       WHERE f.event_id = ?`,
    )
    .all(event.id) as Array<{ fight_id: number; red_price: number | null; blue_price: number | null }>;

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    fights: Object.fromEntries(rows.map((row) => [String(row.fight_id), { redPrice: row.red_price, bluePrice: row.blue_price }])),
  });
}
