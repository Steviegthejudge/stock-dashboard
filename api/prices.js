export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rawTickers = String(req.query.tickers || "").trim();

  if (!rawTickers) {
    return res.status(400).json({ error: "Missing tickers parameter" });
  }

  const tickers = rawTickers
    .split(",")
    .map(t => t.trim().toUpperCase())
    .filter(Boolean);

  if (tickers.length === 0) {
    return res.status(400).json({ error: "No valid tickers provided" });
  }

  const symbols = [...new Set(tickers)].join(",");

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).json({
        error: `Upstream market data request failed with status ${upstream.status}`,
        detail: text.slice(0, 200)
      });
    }

    const data = await upstream.json();

    const results = data?.quoteResponse?.result || [];

    const formatted = results.map(item => ({
      symbol: item.symbol,
      name: item.shortName || item.longName || item.symbol,
      price: item.regularMarketPrice ?? null,
      changePercent: item.regularMarketChangePercent ?? 0,
      currency: item.currency || null
    }));

    return res.status(200).json(formatted);

  } catch (error) {
    return res.status(500).json({
      error: "Server error while fetching market data",
      detail: error.message
    });
  }
}
