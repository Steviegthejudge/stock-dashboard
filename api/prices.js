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

  const apiKey = process.env.MARKETSTACK_ACCESS_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Missing MARKETSTACK_ACCESS_KEY in Vercel environment variables"
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

  // Optional shorthand mapping
  const SYMBOL_MAP = {
    VUSA: "VUSA.L",
    VUAA: "VUAA.L"
  };

  const mappedTickers = tickers.map(t => SYMBOL_MAP[t] || t);
  const symbolsParam = mappedTickers.join(",");

  const url =
  `https://api.marketstack.com/v2/intraday/latest?access_key=${encodeURIComponent(apiKey)}&symbols=${encodeURIComponent(symbolsParam)}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).json({
        error: `Marketstack request failed with status ${upstream.status}`,
        detail: text
      });
    }

    const data = await upstream.json();

    if (data.error) {
      return res.status(502).json({
        error: data.error.message || "Marketstack returned an error",
        detail: data.error
      });
    }

    const rows = Array.isArray(data.data) ? data.data : [];

    // Keep only latest row per symbol
    const latestBySymbol = new Map();
    for (const row of rows) {
      const symbol = row.symbol;
      if (!symbol) continue;

      const existing = latestBySymbol.get(symbol);
      const rowDate = row.date ? new Date(row.date).getTime() : 0;
      const existingDate = existing?.date ? new Date(existing.date).getTime() : 0;

      if (!existing || rowDate > existingDate) {
        latestBySymbol.set(symbol, row);
      }
    }

    const formatted = mappedTickers.map((requestedSymbol, index) => {
      const originalSymbol = tickers[index];
      const item = latestBySymbol.get(requestedSymbol);

      if (!item) {
        return {
          symbol: originalSymbol,
          requestedSymbol,
          found: false,
          price: null,
          changePercent: 0,
          currency: null
        };
      }

      const open = Number(item.open);
      const close = Number(item.close);

      // 🔴 KEY FIX: reject invalid/zero prices
      if (!Number.isFinite(close) || close <= 0) {
        return {
          symbol: originalSymbol,
          requestedSymbol,
          found: false,
          price: null,
          changePercent: 0,
          currency: item.currency_code || null,
          exchange: item.exchange || null,
          marketState: "CLOSED",
          date: item.date || null
        };
      }

      let changePercent = 0;
      if (Number.isFinite(open) && open !== 0) {
        changePercent = ((close - open) / open) * 100;
      }

      return {
        symbol: originalSymbol,
        requestedSymbol,
        found: true,
        name: item.symbol,
        price: close,
        changePercent,
        currency: item.currency_code || null,
        exchange: item.exchange || null,
        marketState: "CLOSED",
        date: item.date || null
      };
    });

    return res.status(200).json(formatted);

  } catch (error) {
    return res.status(500).json({
      error: "Server error while fetching Marketstack data",
      detail: error.message
    });
  }
}
