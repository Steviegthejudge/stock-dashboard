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

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Missing TWELVE_DATA_API_KEY in Vercel environment variables"
    });
  }

  const rawTickers = String(req.query.tickers || "").trim();
  if (!rawTickers) {
    return res.status(400).json({ error: "Missing tickers parameter" });
  }

  const tickers = [...new Set(
    rawTickers
      .split(",")
      .map(t => t.trim().toUpperCase())
      .filter(Boolean)
  )];

  if (tickers.length === 0) {
    return res.status(400).json({ error: "No valid tickers provided" });
  }

  try {
    const symbolParam = tickers.join(",");
    const url =
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbolParam)}&apikey=${encodeURIComponent(apiKey)}`;

    const upstream = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).json({
        error: `Twelve Data request failed with status ${upstream.status}`,
        detail: text.slice(0, 300)
      });
    }

    const data = await upstream.json();

    // Twelve Data can return:
    // - a single object for one symbol
    // - an object keyed by symbol for multiple symbols
    // - an error object with code/message/status

    if (data.status === "error") {
      return res.status(502).json({
        error: data.message || "Twelve Data returned an error",
        detail: data
      });
    }

    const toNumber = (value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const toPercentNumber = (value) => {
      if (value == null) return 0;
      const cleaned = String(value).replace("%", "").trim();
      const num = Number(cleaned);
      return Number.isFinite(num) ? num : 0;
    };

    let quotes = [];

    if (tickers.length === 1 && data && typeof data === "object" && !Array.isArray(data) && data.symbol) {
      quotes = [data];
    } else if (data && typeof data === "object" && !Array.isArray(data)) {
      quotes = Object.values(data).filter(item => item && typeof item === "object");
    }

    const formatted = quotes.map(item => ({
      symbol: item.symbol,
      name: item.name || item.symbol,
      price: toNumber(item.close ?? item.price),
      changePercent: toPercentNumber(item.percent_change),
      currency: item.currency || null,
      exchange: item.exchange || null
    }));

    return res.status(200).json(formatted);
  } catch (error) {
    return res.status(500).json({
      error: "Server error while fetching market data",
      detail: error.message
    });
  }
}
