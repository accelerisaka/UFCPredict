const UFC_HEADERS = {
  "user-agent": "UFCPredict/1.0 (personal schedule viewer)",
  accept: "text/html,application/xhtml+xml",
  "accept-language": "en-US,en;q=0.9",
};

let lastUfcFetch = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchText(url: string, attempt = 0): Promise<string> {
  const wait = 450 - (Date.now() - lastUfcFetch);
  if (wait > 0) await sleep(wait);
  lastUfcFetch = Date.now();

  const response = await fetch(url, {
    headers: UFC_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });

  if ((response.status === 429 || response.status >= 500) && attempt < 2) {
    await sleep(1500 * (attempt + 1));
    return fetchText(url, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`UFC 页面返回 ${response.status}：${url}`);
  }
  return response.text();
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "user-agent": "UFCPredict/1.0",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`请求失败 ${response.status}：${url}`);
  }
  return (await response.json()) as T;
}
