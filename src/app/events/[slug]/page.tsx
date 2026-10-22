import Link from "next/link";
import { notFound } from "next/navigation";
import { FightBoard } from "@/components/FightBoard";
import { getCurrentUser } from "@/lib/auth";
import { formatWhen } from "@/lib/format";
import { getEvent } from "@/lib/read";
import { ensureSchedule, refreshEventPrices } from "@/lib/sync";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await ensureSchedule();
  const user = await getCurrentUser();
  const detail = getEvent(slug, user?.id ?? null);
  if (!detail) notFound();
  try {
    await refreshEventPrices(detail.event.id);
  } catch {
    // 页面仍展示上一口价格。
  }
  const refreshed = getEvent(slug, user?.id ?? null) || detail;

  return (
    <div className="page">
      <p className="crumb">
        <Link href="/">赛程</Link>
        <span>/</span>
        {refreshed.event.name}
      </p>
      <section className="event-banner" style={refreshed.event.image ? { backgroundImage: `linear-gradient(90deg, rgba(12,14,10,0.92), rgba(12,14,10,0.55)), url(${refreshed.event.image})` } : undefined}>
        <p className="eyebrow">{refreshed.event.name}</p>
        <h1>{refreshed.event.headline || refreshed.event.mainEvent}</h1>
        <p>
          {formatWhen(refreshed.event.startsAt)}
          {refreshed.event.venue ? ` · ${refreshed.event.venue}` : ""}
        </p>
        <p className="fine">{refreshed.event.fightCount} 场已确定对阵 · {refreshed.event.pricedCount} 场已匹配 Polymarket</p>
      </section>
      <section className="rule">
        <p>
          每场预测固定投入 100 美元。有订单簿时，锁定点击当时的买入价；如果 Polymarket 只公布了一方价格，另一方按 1 减去该价格计算。猜中返还 100 ÷ 锁定价格，未猜中返还 0。平局和无效比赛退回本金。比赛取消，或赛前任一侧选手被更换，会立刻取消未结算的预测、退回本金，并在个人页留下记录；对阵更新后可以重新预测。自己点取消则直接删掉这次预测。比赛对应时段开始后不能再改，也不能自己取消。
        </p>
      </section>
      <FightBoard eventSlug={refreshed.event.slug} initialFights={refreshed.fights} loggedIn={Boolean(user)} />
    </div>
  );
}
