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

  const tickers = [...new Set(
    rawTickers
      .split(",")
      .map(t => t.trim().toUpperCase())
      .filter(Boolean)
  )];

  if (tickers.length === 0) {
    return res.status(400).json({ error: "No valid tickers provided" });
  }

  // Optional shorthand mapping for common UK ETFs
  const SYMBOL_MAP = {
    VUSA: "VUSA.L",
    VUAA: "VUAA.L"
  };

  const mappedTickers = tickers.map(t => SYMBOL_MAP[t] || t);
  const symbolParam = mappedTickers.join(",");

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbolParam)}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
        "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
        "Referer": "https://finance.yahoo.com/"
      }
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(502).json({
        error: `Yahoo market data request failed with status ${upstream.status}`,
        detail: text.slice(0, 300)
      });
    }

    const data = await upstream.json();
    const results = Array.isArray(data?.quoteResponse?.result)
      ? data.quoteResponse.result
      : [];

    const bySymbol = new Map(results.map(item => [item.symbol, item]));

    const formatted = mappedTickers.map((requestedSymbol, index) => {
      const originalSymbol = tickers[index];
      const item = bySymbol.get(requestedSymbol);

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

      return {
        symbol: originalSymbol,
        requestedSymbol,
        found: true,
        name: item.shortName || item.longName || originalSymbol,
        price: Number.isFinite(Number(item.regularMarketPrice))
          ? Number(item.regularMarketPrice)
          : null,
        changePercent: Number.isFinite(Number(item.regularMarketChangePercent))
          ? Number(item.regularMarketChangePercent)
          : 0,
        currency: item.currency || null,
        exchange: item.fullExchangeName || item.exchange || null,
        marketState: item.marketState || null
      };
    });

    return res.status(200).json(formatted);
  } catch (error) {
    return res.status(500).json({
      error: "Server error while fetching Yahoo market data",
      detail: error.message
    });
  }
}
