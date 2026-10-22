"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelPrediction, placePrediction } from "@/app/actions";
import {
  formatMethod,
  formatPrice,
  formatSegment,
  formatWhen,
  isBettingClosed,
  isValidPrice,
  money,
  payoutCents,
  predictionLabel,
  segmentOrder,
  STAKE_CENTS,
} from "@/lib/format";
import type { CornerView, FightView } from "@/lib/types";

type QuoteMap = Record<string, { redPrice: number | null; bluePrice: number | null }>;

function predictionKey(prediction: FightView["prediction"]): string {
  return `${prediction?.fighterId ?? ""}:${prediction?.status ?? ""}`;
}

function signatureOf(fights: FightView[]): string {
  return fights
    .map((fight) => `${fight.id}:${fight.status}:${predictionKey(fight.prediction)}:${fight.prediction?.lockedPrice ?? ""}`)
    .join("|");
}

function Corner({
  corner,
  side,
  price,
  selected,
  closed,
  held,
  loggedIn,
  busy,
  picking,
  onPick,
}: {
  corner: CornerView;
  side: "red" | "blue";
  price: number | null;
  selected: boolean;
  closed: boolean;
  held: boolean;
  loggedIn: boolean;
  busy: boolean;
  picking: boolean;
  onPick: () => void;
}) {
  const payout = isValidPrice(price) ? payoutCents(STAKE_CENTS, price) : null;
  return (
    <article className={`corner corner-${side} ${corner.isWinner ? "is-winner" : ""} ${selected ? "is-selected" : ""}`}>
      <div className="corner-id">
        {corner.image ? <img src={corner.image} alt="" /> : <span className="avatar-fallback">{corner.name.slice(0, 1)}</span>}
        <div>
          {corner.rank ? <span className="rank">{corner.rank}</span> : null}
          <h3>
            <Link href={`/fighters/${corner.slug}`}>{corner.name}</Link>
          </h3>
          {corner.nickname ? <p className="nickname">“{corner.nickname}”</p> : null}
        </div>
      </div>
      <p className="record">{corner.record || "战绩同步中"}</p>
      <dl className="physique">
        <div>
          <dt>身高</dt>
          <dd>{corner.height || "—"}</dd>
        </div>
        <div>
          <dt>臂展</dt>
          <dd>{corner.reach || "—"}</dd>
        </div>
        <div>
          <dt>体重</dt>
          <dd>{corner.weight || "—"}</dd>
        </div>
      </dl>
      <div className="odds-block">
        {isValidPrice(price) ? (
          <>
            <strong>{formatPrice(price)}</strong>
            <span>100 美元买入，猜中返还 {money(payout || 0)}</span>
          </>
        ) : (
          <strong>暂无盘口</strong>
        )}
      </div>
      {loggedIn ? (
        <button className="button pick" type="button" disabled={closed || held || busy || !isValidPrice(price)} onClick={onPick}>
          {picking ? "锁定价格…" : closed ? (selected ? "当前预测" : "已截止") : selected ? "当前预测" : held ? "请先取消预测" : `预测 ${corner.name} 获胜`}
        </button>
      ) : (
        <span className="login-hint">登录后可预测</span>
      )}
    </article>
  );
}

export function FightBoard({
  eventSlug,
  initialFights,
  loggedIn,
}: {
  eventSlug: string;
  initialFights: FightView[];
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [fights, setFights] = useState(initialFights);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const busyFights = useRef(new Set<number>());
  const latest = useRef(initialFights);
  latest.current = initialFights;
  const signature = useMemo(() => signatureOf(initialFights), [initialFights]);

  useEffect(() => {
    setFights(latest.current);
  }, [signature]);

  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const response = await fetch(`/api/odds?event=${encodeURIComponent(eventSlug)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as { updatedAt?: string; fights?: QuoteMap };
        if (stopped || !payload.fights) return;
        setUpdatedAt(payload.updatedAt || new Date().toISOString());
        setFights((current) =>
          current.map((fight) => {
            const quote = payload.fights?.[String(fight.id)];
            if (!quote || !fight.market) return fight;
            return {
              ...fight,
              market: {
                ...fight.market,
                redPrice: quote.redPrice,
                bluePrice: quote.bluePrice,
                updatedAt: payload.updatedAt || fight.market.updatedAt,
              },
            };
          }),
        );
      } catch {
        // 保留上一口价格，下一轮再试。
      }
    }
    void tick();
    const timer = setInterval(() => void tick(), 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [eventSlug]);

  const groups = new Map<string, FightView[]>();
  for (const fight of fights) {
    const label = formatSegment(fight.segment);
    const list = groups.get(label) || [];
    list.push(fight);
    groups.set(label, list);
  }
  const labels = [...groups.keys()].sort((a, b) => segmentOrder(a) - segmentOrder(b) || a.localeCompare(b, "zh-CN"));

  async function onPick(fight: FightView, fighterId: number) {
    if (!loggedIn) {
      router.push(`/login?next=/events/${eventSlug}`);
      return;
    }
    if (fight.prediction?.status === "open") {
      setMessage("请先取消当前预测");
      return;
    }
    if (busyFights.current.has(fight.id)) return;
    busyFights.current.add(fight.id);
    const key = `${fight.id}:pick:${fighterId}`;
    setPendingKey(key);
    setMessage(null);
    try {
      const result = await placePrediction(fight.id, fighterId);
      if (!result.ok || result.lockedPrice == null) {
        setMessage(result.ok ? "当前价格不可用，请稍后再试" : result.error);
        return;
      }
      const lockedPrice = result.lockedPrice;
      setFights((current) =>
        current.map((item) =>
          item.id === fight.id
            ? {
                ...item,
                prediction: {
                  fighterId,
                  lockedPrice,
                  stakeCents: STAKE_CENTS,
                  payoutCents: null,
                  status: "open",
                  note: null,
                },
              }
            : item,
        ),
      );
      setMessage("已按实时买入价锁定 100 美元模拟下注。");
    } finally {
      busyFights.current.delete(fight.id);
      setPendingKey(null);
    }
  }

  async function onCancel(fight: FightView) {
    if (fight.prediction?.status !== "open") return;
    if (busyFights.current.has(fight.id)) return;
    busyFights.current.add(fight.id);
    setPendingKey(`${fight.id}:cancel`);
    setMessage(null);
    try {
      const result = await cancelPrediction(fight.id);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setFights((current) => current.map((item) => (item.id === fight.id ? { ...item, prediction: null } : item)));
      setMessage("已取消这场预测，可以重新选择。");
    } finally {
      busyFights.current.delete(fight.id);
      setPendingKey(null);
    }
  }

  return (
    <div className="board">
      <div className="board-meta">
        <span>{updatedAt ? `赔率更新于 ${formatWhen(updatedAt)}` : "正在读取 Polymarket 实时买入价"}</span>
        {message ? <span className="board-message">{message}</span> : null}
      </div>
      {labels.map((label) => (
        <section key={label} className="segment">
          <h2>{label}</h2>
          {(groups.get(label) || []).map((fight) => {
            const closed = isBettingClosed(fight.status, fight.segmentStartsAt);
            const held = fight.prediction?.status === "open";
            const cancelling = pendingKey === `${fight.id}:cancel`;
            const fightPending = pendingKey?.startsWith(`${fight.id}:`) ?? false;
            const result = formatMethod(fight.method, fight.endedRound, fight.endedTime);
            const redShare =
              fight.market?.redPrice != null && fight.market.bluePrice != null && fight.market.redPrice + fight.market.bluePrice > 0
                ? (fight.market.redPrice / (fight.market.redPrice + fight.market.bluePrice)) * 100
                : null;
            return (
              <section key={fight.id} className="bout">
                <header className="bout-head">
                  <span>{fight.weightClass}</span>
                  {fight.isTitle ? <span className="title-pill">冠军赛</span> : null}
                  <span className="bout-state">
                    {result || (fight.segmentStartsAt ? `开赛 ${formatWhen(fight.segmentStartsAt)}` : "未开始")}
                  </span>
                </header>
                <div className="bout-grid">
                  <Corner
                    corner={fight.red}
                    side="red"
                    price={fight.market?.redPrice ?? null}
                    selected={fight.prediction?.status === "open" && fight.prediction.fighterId === fight.red.id}
                    closed={closed}
                    held={held && !closed}
                    loggedIn={loggedIn}
                    busy={fightPending}
                    picking={pendingKey === `${fight.id}:pick:${fight.red.id}`}
                    onPick={() => void onPick(fight, fight.red.id)}
                  />
                  <div className="versus">
                    <span>VS</span>
                    {fight.market?.url ? (
                      <a href={fight.market.url} target="_blank" rel="noreferrer">
                        Polymarket
                      </a>
                    ) : null}
                  </div>
                  <Corner
                    corner={fight.blue}
                    side="blue"
                    price={fight.market?.bluePrice ?? null}
                    selected={fight.prediction?.status === "open" && fight.prediction.fighterId === fight.blue.id}
                    closed={closed}
                    held={held && !closed}
                    loggedIn={loggedIn}
                    busy={fightPending}
                    picking={pendingKey === `${fight.id}:pick:${fight.blue.id}`}
                    onPick={() => void onPick(fight, fight.blue.id)}
                  />
                </div>
                {fight.prediction ? (
                  <div className="bout-foot">
                    <p className={`pick-note status-${fight.prediction.status}`}>
                      {predictionLabel(fight.prediction.status)}
                      {fight.prediction.status === "open"
                        ? ` · 锁定 ${(fight.prediction.lockedPrice * 100).toFixed(1)}%`
                        : fight.prediction.payoutCents != null
                          ? ` · 返还 ${money(fight.prediction.payoutCents)}`
                          : ""}
                      {fight.prediction.note ? ` · ${fight.prediction.note}` : ""}
                    </p>
                    {held && !closed ? (
                      <button className="button small" type="button" disabled={fightPending} onClick={() => void onCancel(fight)}>
                        {cancelling ? "取消中…" : "取消预测"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {redShare != null ? (
                  <div className="price-bar" aria-hidden="true">
                    <span style={{ width: `${redShare}%` }} />
                  </div>
                ) : null}
              </section>
            );
          })}
        </section>
      ))}
    </div>
  );
}
