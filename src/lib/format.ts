export const STAKE_CENTS = 10_000;

const WEIGHTS: [string, string][] = [
  ["women's strawweight", "女子草量级"],
  ["women's flyweight", "女子蝇量级"],
  ["women's bantamweight", "女子雏量级"],
  ["women's featherweight", "女子羽量级"],
  ["light heavyweight", "轻重量级"],
  ["featherweight", "羽量级"],
  ["bantamweight", "雏量级"],
  ["welterweight", "次中量级"],
  ["middleweight", "中量级"],
  ["lightweight", "轻量级"],
  ["heavyweight", "重量级"],
  ["flyweight", "蝇量级"],
  ["strawweight", "草量级"],
  ["catch weight", "约定体重"],
];

const METHODS: Record<string, string> = {
  "KO/TKO": "击倒",
  "Decision - Unanimous": "一致判定",
  "Decision - Split": "分歧判定",
  "Decision - Majority": "多数判定",
  Submission: "降服",
  "Could Not Continue": "无法继续",
  DQ: "取消资格",
  Overturned: "改判",
};

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const formatted = (absolute / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}$${formatted}`;
}

export function signedMoney(cents: number): string {
  if (cents > 0) return `+${money(cents)}`;
  return money(cents);
}

export function payoutCents(stakeCents: number, price: number): number {
  return Math.round(stakeCents / price);
}

export function isValidPrice(price: number | null | undefined): price is number {
  return typeof price === "number" && price >= 0.01 && price <= 0.99;
}

export function decimalOdds(price: number): number {
  return 1 / price;
}

export function americanOdds(price: number): number {
  if (price >= 0.5) return Math.round(-(price / (1 - price)) * 100);
  return Math.round(((1 - price) / price) * 100);
}

export function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}

export function formatPrice(price: number): string {
  const percent = (price * 100).toFixed(1);
  const decimal = decimalOdds(price).toFixed(2);
  return `${percent}% · ${decimal} · ${formatAmerican(americanOdds(price))}`;
}

export function formatInches(inches: number | null, kind: "height" | "reach"): string | null {
  if (inches == null || !Number.isFinite(inches) || inches <= 0) return null;
  const cm = Math.round(inches * 2.54);
  if (kind === "height") {
    const total = Math.round(inches);
    const feet = Math.floor(total / 12);
    const inch = total % 12;
    return `${feet}'${inch}" · ${cm} cm`;
  }
  return `${inches.toFixed(1)}" · ${cm} cm`;
}

export function formatWeight(pounds: number | null): string | null {
  if (pounds == null || !Number.isFinite(pounds) || pounds <= 0) return null;
  const kg = pounds * 0.45359237;
  return `${pounds.toFixed(1)} lb · ${kg.toFixed(1)} kg`;
}

export function translateWeight(text: string | null): string {
  if (!text) return "级别待定";
  const lower = text.toLowerCase();
  const match = WEIGHTS.find(([english]) => lower.includes(english));
  if (!match) return text;
  return match[1];
}

export function formatRank(rank: string | null): string | null {
  if (!rank) return null;
  if (rank === "C" || /champ/i.test(rank)) return "冠军";
  return rank;
}

export function formatSegment(segment: string | null): string {
  const value = (segment || "").toLowerCase();
  if (value.includes("early")) return "早场副赛";
  if (value.includes("prelim")) return "副赛";
  if (value.includes("main")) return "主赛";
  return segment || "对阵";
}

export function segmentOrder(segment: string | null): number {
  const label = formatSegment(segment);
  if (label === "主赛") return 0;
  if (label === "副赛") return 1;
  if (label === "早场副赛") return 2;
  return 3;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "时间待定";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "时间待定";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatMethod(method: string | null, round: string | null, time: string | null): string | null {
  if (!method && !round && !time) return null;
  const label = method ? METHODS[method] || method : "已结束";
  const parts = [label];
  if (round) parts.push(`第 ${round} 回合`);
  if (time) parts.push(time);
  return parts.join(" · ");
}

export function fightStatusLabel(status: string): string {
  switch (status) {
    case "final":
      return "已结束";
    case "draw":
      return "平局";
    case "no_contest":
      return "无效比赛";
    case "cancelled":
      return "取消";
    default:
      return "未开始";
  }
}

export function predictionLabel(status: string): string {
  switch (status) {
    case "won":
      return "猜中";
    case "lost":
      return "未中";
    case "void":
      return "走盘";
    default:
      return "未结算";
  }
}

export function isBettingClosed(status: string, segmentStartsAt: string | null, now = Date.now()): boolean {
  if (status !== "scheduled") return true;
  if (!segmentStartsAt) return false;
  const time = Date.parse(segmentStartsAt);
  return Number.isFinite(time) && now >= time;
}

export function safeUfcImage(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, "https://www.ufc.com");
    if (parsed.protocol !== "https:") return null;
    if (!parsed.hostname.endsWith("ufc.com")) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function polymarketEventUrl(slug: string | null | undefined): string | null {
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) return null;
  return `https://polymarket.com/event/${slug}`;
}

export function percent(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}
