import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { formatMethod, formatWhen, money, percent, predictionLabel, signedMoney } from "@/lib/format";
import { getProfile } from "@/lib/read";
import { ensureSchedule } from "@/lib/sync";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/me");
  await ensureSchedule();
  const { summary, history } = getProfile(user.id);
  const decisive = summary.wins + summary.losses;
  const profitClass = summary.profitCents > 0 ? "up" : summary.profitCents < 0 ? "down" : "";

  return (
    <div className="page">
      <section className="intro compact">
        <p className="eyebrow">{user.username}</p>
        <h1>预测账本</h1>
        <p className="lede">准确率只计算已经分出胜负的预测。平局、无效比赛、比赛取消和赛前对手更换都记为走盘，退回本金，不进入准确率。自动取消会留在下面的记录里。</p>
      </section>

      <section className="ledger">
        <article>
          <span>预测准确率</span>
          <strong>{percent(summary.wins, decisive)}</strong>
          <small>{decisive > 0 ? `${summary.wins} 中 / ${decisive} 场分出胜负` : "还没有分出胜负的预测"}</small>
        </article>
        <article>
          <span>累计投入</span>
          <strong>{money(summary.stakedCents)}</strong>
          <small>
            {summary.total} 场 · 未结算 {money(summary.openStakeCents)}
          </small>
        </article>
        <article>
          <span>已返还</span>
          <strong>{money(summary.returnedCents)}</strong>
          <small>已结算投入 {money(summary.settledStakeCents)}</small>
        </article>
        <article>
          <span>目前盈亏</span>
          <strong className={profitClass}>{signedMoney(summary.profitCents)}</strong>
          <small>
            {summary.wins} 胜 {summary.losses} 负 {summary.voids} 走盘
          </small>
        </article>
      </section>

      <section className="event-section">
        <h2>预测记录</h2>
        {history.length === 0 ? <p className="empty">还没有预测。去赛程里选一场已经开出赔率的比赛。</p> : null}
        <div className="history">
          {history.map((item) => {
            const profit = item.status === "open" || item.payoutCents == null ? null : item.payoutCents - item.stakeCents;
            return (
              <Link key={item.id} href={`/events/${item.eventSlug}`} className="history-row ledger-row">
                <span>{formatWhen(item.startsAt)}</span>
                <strong>
                  {item.eventName}
                  <em>
                    {item.redName} vs {item.blueName}
                  </em>
                </strong>
                <span>预测 {item.pickName}</span>
                <span className={`status-${item.status}`}>{predictionLabel(item.status)}</span>
                <span>
                  {item.status === "open"
                    ? `潜在返还 ${money(Math.round(item.stakeCents / item.lockedPrice))}`
                    : `返还 ${money(item.payoutCents || 0)}`}
                  {profit != null ? ` · ${signedMoney(profit)}` : ""}
                  {item.winnerName ? ` · 胜者 ${item.winnerName}` : ""}
                  {formatMethod(item.method, item.endedRound, item.endedTime) ? ` · ${formatMethod(item.method, item.endedRound, item.endedTime)}` : ""}
                  {item.note ? ` · ${item.note}` : ""}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
