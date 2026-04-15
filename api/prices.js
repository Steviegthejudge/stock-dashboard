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
      error: "Missing MARKETSTACK_ACCESS_KEY"
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

  // Map Trading212-style tickers → exchange format
  const SYMBOL_MAP = {
    VUSA: "VUSA.L",
    VUAA: "VUAA.L"
  };

  const mappedTickers = tickers.map(t => SYMBOL_MAP[t] || t);
  const symbolsParam = mappedTickers.join(",");

  // 🔥 NEW: add exchange=XLON for London-listed ETFs
  const url =
    `https://api.marketstack.com/v2/eod/latest?access_key=${encodeURIComponent(apiKey)}&symbols=${encodeURIComponent(symbolsParam)}&exchange=XLON`;

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
        error: data.error.message || "Marketstack error",
        detail: data.error
      });
    }

    const rows = Array.isArray(data.data) ? data.data : [];

    const latestBySymbol = new Map();
    for (const row of rows) {
      if (!row.symbol) continue;
      latestBySymbol.set(row.symbol, row);
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

      // ✅ Reject invalid ETF data (0 or missing)
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
      error: "Server error",
      detail: error.message
    });
  }
}
