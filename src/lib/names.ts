const NAME_STOP = new Set(["jr", "sr", "ii", "iii", "iv", "da", "de", "dos", "van", "von"]);

export function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NAME_STOP.has(token));
}

export function namesMatch(fighterName: string, outcome: string): boolean {
  const fighterTokens = nameTokens(fighterName);
  const outcomeTokens = new Set(nameTokens(outcome));
  if (fighterTokens.length === 0 || outcomeTokens.size === 0) return false;

  const longest = [...fighterTokens].sort((a, b) => b.length - a.length)[0];
  if (!outcomeTokens.has(longest)) return false;

  const hits = fighterTokens.filter((token) => outcomeTokens.has(token)).length;
  if (fighterTokens.length >= 2 && outcomeTokens.size >= 2) return hits >= 2;
  return hits >= 1;
}

export function assignOutcomes(
  redName: string,
  blueName: string,
  outcomes: string[],
): { redIndex: number; blueIndex: number } | null {
  let redIndex = -1;
  let blueIndex = -1;

  outcomes.forEach((outcome, index) => {
    const red = namesMatch(redName, outcome);
    const blue = namesMatch(blueName, outcome);
    if (red && !blue) redIndex = index;
    if (blue && !red) blueIndex = index;
  });

  if (redIndex < 0 || blueIndex < 0 || redIndex === blueIndex) return null;
  return { redIndex, blueIndex };
}
