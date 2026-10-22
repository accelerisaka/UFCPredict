export type FightResultStatus = "final" | "draw" | "no_contest" | "cancelled";

export function matchupChanged(previousRed: number, previousBlue: number, nextRed: number, nextBlue: number): boolean {
  const sameCorners = previousRed === nextRed && previousBlue === nextBlue;
  const swappedCorners = previousRed === nextBlue && previousBlue === nextRed;
  return !sameCorners && !swappedCorners;
}

export function cancelledPredictionNote(): string {
  return "比赛取消，预测已取消，本金退回";
}

export function opponentChangeNote(redName: string, blueName: string): string {
  return `对手更换，原对阵 ${redName} vs ${blueName}，预测已取消，本金退回`;
}

export function settlementOf(input: {
  status: FightResultStatus;
  winnerFighterId: number | null;
  predictedFighterId: number;
  stakeCents: number;
  lockedPrice: number;
}): { status: "won" | "lost" | "void"; payoutCents: number; note: string } {
  if (input.status === "cancelled") {
    return { status: "void", payoutCents: input.stakeCents, note: cancelledPredictionNote() };
  }
  if (input.status === "draw") {
    return { status: "void", payoutCents: input.stakeCents, note: "平局，本金退回" };
  }
  if (input.status === "no_contest") {
    return { status: "void", payoutCents: input.stakeCents, note: "比赛无效，本金退回" };
  }
  if (input.winnerFighterId != null && input.winnerFighterId === input.predictedFighterId) {
    return {
      status: "won",
      payoutCents: Math.round(input.stakeCents / input.lockedPrice),
      note: "猜中，按锁定价格结算",
    };
  }
  return { status: "lost", payoutCents: 0, note: "未猜中" };
}
