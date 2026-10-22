import Link from "next/link";
import { notFound } from "next/navigation";
import { fightStatusLabel, formatWhen, translateWeight } from "@/lib/format";
import { getFighter } from "@/lib/read";
import { ensureSchedule } from "@/lib/sync";

export const dynamic = "force-dynamic";

function translateStatus(status: string | null): string | null {
  if (!status) return null;
  if (/^active$/i.test(status)) return "现役";
  if (/not fighting/i.test(status)) return "未出战";
  return status;
}

function translateTag(tag: string): string {
  if (/title holder/i.test(tag)) return "冠军";
  if (/^active$/i.test(tag)) return "现役";
  if (/division/i.test(tag)) return translateWeight(tag);
  return tag.replace(/pfp/i, "磅对磅");
}

const STAT_LABELS: Record<string, string> = {
  "Wins by Knockout": "击倒获胜",
  "Wins by Submission": "降服获胜",
  "Wins by Decision": "判定获胜",
  "First Round Finishes": "第一回合终结",
  "Title Defenses": "成功卫冕",
};

export default async function FighterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await ensureSchedule();
  const fighter = getFighter(slug);
  if (!fighter) notFound();

  const facts = [
    ["战绩", fighter.record],
    ["级别", fighter.division ? translateWeight(fighter.division) : null],
    ["状态", translateStatus(fighter.status)],
    ["年龄", fighter.age ? `${fighter.age} 岁` : null],
    ["身高", fighter.height],
    ["臂展", fighter.reach],
    ["腿展", fighter.legReach],
    ["体重", fighter.weight],
    ["出生地", fighter.birthplace],
    ["训练馆", fighter.trainsAt],
    ["八角笼首秀", fighter.octagonDebut],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <div className="page">
      <p className="crumb">
        <Link href="/">赛程</Link>
        <span>/</span>
        {fighter.name}
      </p>
      <section className="fighter-hero">
        {fighter.image ? <img src={fighter.image} alt="" /> : <div className="avatar-fallback large">{fighter.name.slice(0, 1)}</div>}
        <div>
          <div className="tag-row">
            {fighter.tags.map((tag) => (
              <span key={tag}>{translateTag(tag)}</span>
            ))}
          </div>
          {fighter.nickname ? <p className="nickname large">“{fighter.nickname}”</p> : null}
          <h1>{fighter.name}</h1>
          <p className="record large">{fighter.record || "官网战绩同步中"}</p>
          {fighter.profileUrl ? (
            <a className="text-link" href={fighter.profileUrl} target="_blank" rel="noreferrer">
              在 UFC.com 查看
            </a>
          ) : null}
        </div>
      </section>

      <section className="fact-grid">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </section>

      {fighter.heroStats.length > 0 ? (
        <section className="stat-row">
          {fighter.heroStats.map((stat) => (
            <div key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{STAT_LABELS[stat.label] || stat.label}</span>
            </div>
          ))}
        </section>
      ) : null}

      <section className="event-section">
        <h2>相关比赛</h2>
        <div className="history">
          {fighter.fights.map((fight) => (
            <Link key={`${fight.eventSlug}-${fight.opponent}`} href={`/events/${fight.eventSlug}`} className="history-row">
              <span>{formatWhen(fight.startsAt)}</span>
              <strong>
                {fight.eventName} · 对 {fight.opponent}
              </strong>
              <span>{fight.weightClass}</span>
              <span>{fightStatusLabel(fight.status)}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
