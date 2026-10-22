export type CornerView = {
  id: number;
  slug: string;
  name: string;
  nickname: string | null;
  record: string | null;
  height: string | null;
  reach: string | null;
  weight: string | null;
  age: number | null;
  division: string | null;
  image: string | null;
  rank: string | null;
  isWinner: boolean;
};

export type MarketView = {
  redPrice: number | null;
  bluePrice: number | null;
  volume: number | null;
  url: string | null;
  updatedAt: string | null;
};

export type PredictionView = {
  fighterId: number;
  lockedPrice: number;
  stakeCents: number;
  payoutCents: number | null;
  status: string;
  note: string | null;
};

export type FightView = {
  id: number;
  segment: string | null;
  segmentStartsAt: string | null;
  weightClass: string;
  isTitle: boolean;
  status: string;
  method: string | null;
  endedRound: string | null;
  endedTime: string | null;
  red: CornerView;
  blue: CornerView;
  market: MarketView | null;
  prediction: PredictionView | null;
};

export type EventCard = {
  slug: string;
  name: string;
  headline: string | null;
  startsAt: string | null;
  venue: string | null;
  image: string | null;
  fightCount: number;
  pricedCount: number;
  mainEvent: string | null;
  phase: "upcoming" | "awaiting" | "final";
};
