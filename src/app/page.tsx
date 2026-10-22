import Link from "next/link";
import { SyncButton } from "@/components/SyncButton";
import { fightStatusLabel, formatWhen } from "@/lib/format";
import { listEvents, getSyncStatus } from "@/lib/read";
import { ensurePrices, ensureSchedule } from "@/lib/sync";

export const dynamic = "force-dynamic";

const PHASE = {
  upcoming: "未开始",
  awaiting: "等待赛果",
  final: "已结束",
} as const;

export default async function HomePage() {
  const sync = await ensureSchedule();
  await ensurePrices();
  const events = listEvents();
  const status = getSyncStatus();
  const upcoming = events.filter((event) => event.phase !== "final");
  const finished = events.filter((event) => event.phase === "final");
  const confirmed = upcoming.reduce((sum, event) => sum + event.fightCount, 0);

  return (
    <div className="page">
      <section className="intro">
        <p className="eyebrow">已确定的未来比赛</p>
        <h1>把每一场预测都当成 100 美元。</h1>
        <p className="lede">
          这里收集 UFC 官网已经公布对手的比赛，展示双方身高、臂展和战绩，并用 Polymarket 的实时买入价结算。猜中返还 100 ÷ 锁定价格，没猜中归零。比赛取消或赛前换对手会退回本金，并留下记录。
        </p>
        <div className="intro-row">
          <p className="stat-pill">
            <strong>{confirmed}</strong>
            <span>场待开打</span>
          </p>
          <SyncButton />
        </div>
        {sync.message || status.error ? <p className="banner error">{sync.message || status.error}</p> : null}
        {status.syncedAt ? <p className="fine">赛程同步于 {formatWhen(status.syncedAt)}（北京时间）</p> : null}
      </section>

      <EventSection title="未来赛程" events={upcoming} empty="还没有同步到已确定的比赛。点一次同步，或稍等官网页面恢复。" />
      {finished.length > 0 ? <EventSection title="最近结束" events={finished} empty="" /> : null}
    </div>
  );
}

function EventSection({
  title,
  events,
  empty,
}: {
  title: string;
  events: ReturnType<typeof listEvents>;
  empty: string;
}) {
  return (
    <section className="event-section">
      <h2>{title}</h2>
      {events.length === 0 ? <p className="empty">{empty}</p> : null}
      <div className="event-list">
        {events.map((event) => (
          <Link key={event.slug} href={`/events/${event.slug}`} className="event-row">
            <div className="event-art" style={event.image ? { backgroundImage: `url(${event.image})` } : undefined} />
            <div>
              <p className="event-kicker">
                {event.name} · {PHASE[event.phase] || fightStatusLabel(event.phase)}
              </p>
              <h3>{event.mainEvent || event.headline}</h3>
              <p className="event-meta">
                {formatWhen(event.startsAt)}
                {event.venue ? ` · ${event.venue}` : ""}
              </p>
            </div>
            <p className="event-count">
              <strong>{event.fightCount}</strong>
              <span>场已确定</span>
              <span>{event.pricedCount} 场有赔率</span>
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
