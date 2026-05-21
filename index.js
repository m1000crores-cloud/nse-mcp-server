const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

let nseCookies = '';

async function getNSECookies() {
  try {
    const res = await axios.get('https://www.nseindia.com/', { headers: NSE_HEADERS, timeout: 10000 });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) nseCookies = setCookie.map(c => c.split(';')[0]).join('; ');
  } catch (e) { console.error('Cookie fetch failed:', e.message); }
}

async function nseGet(url) {
  if (!nseCookies) await getNSECookies();
  try {
    const res = await axios.get(url, { headers: { ...NSE_HEADERS, Cookie: nseCookies }, timeout: 15000 });
    return res.data;
  } catch (e) {
    await getNSECookies();
    const res = await axios.get(url, { headers: { ...NSE_HEADERS, Cookie: nseCookies }, timeout: 15000 });
    return res.data;
  }
}

const TOOLS = [
  { name: 'get_corporate_announcements', description: 'Get latest corporate announcements for a stock from NSE', inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, count: { type: 'number' } }, required: ['symbol'] } },
  { name: 'get_result_dates', description: 'Get board meeting and result dates for a stock', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
  { name: 'get_bulk_block_deals', description: 'Get bulk and block deals on NSE', inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, date: { type: 'string' } } } },
  { name: 'get_shareholding_pattern', description: 'Get promoter FII DII shareholding pattern', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
  { name: 'get_fii_dii_data', description: 'Get FII and DII buy sell data', inputSchema: { type: 'object', properties: { date: { type: 'string' } } } },
  { name: 'get_stock_quote', description: 'Get full stock quote with OHLC 52week high low PE circuit limits', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
  { name: 'get_market_status', description: 'Get Nifty BankNifty VIX top gainers losers', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_upcoming_events', description: 'Get upcoming dividends bonus splits AGMs', inputSchema: { type: 'object', properties: { event_type: { type: 'string' }, days: { type: 'number' } } } },
  { name: 'get_insider_trading', description: 'Get promoter insider buying selling disclosures', inputSchema: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'] } },
  { name: 'search_announcements_by_keyword', description: 'Search NSE announcements by keyword like order win expansion QIP', inputSchema: { type: 'object', properties: { keyword: { type: 'string' }, days: { type: 'number' } }, required: ['keyword'] } },
];

async function handle_get_corporate_announcements({ symbol, count = 10 }) {
  const sym = symbol.toUpperCase();
  const data = await nseGet(`https://www.nseindia.com/api/corp-info?symbol=${sym}&corpType=announcements&market=equities`);
  const announcements = (data?.corpAnnouncementData || []).slice(0, Math.min(count, 50));
  return { symbol: sym, total: announcements.length, announcements: announcements.map(a => ({ date: a.exchdisstime, subject: a.desc || a.subject })) };
}

async function handle_get_result_dates({ symbol }) {
  const sym = symbol.toUpperCase();
  const data = await nseGet(`https://www.nseindia.com/api/corp-info?symbol=${sym}&corpType=boardMeeting&market=equities`);
  return { symbol: sym, board_meetings: (data?.corpMeetingData || []).slice(0, 20).map(m => ({ purpose: m.purpose, date: m.bm_date })) };
}

async function handle_get_bulk_block_deals({ symbol, date }) {
  const today = date || new Date().toISOString().split('T')[0];
  const [bulk, block] = await Promise.allSettled([nseGet(`https://www.nseindia.com/api/bulkdeals?date=${today}`), nseGet(`https://www.nseindia.com/api/blockdeals?date=${today}`)]);
  let bulkData = bulk.status === 'fulfilled' ? (bulk.value?.data || []) : [];
  let blockData = block.status === 'fulfilled' ? (block.value?.data || []) : [];
  if (symbol) { const sym = symbol.toUpperCase(); bulkData = bulkData.filter(d => d.symbol?.toUpperCase() === sym); blockData = blockData.filter(d => d.symbol?.toUpperCase() === sym); }
  return { date: today, bulk_deals: bulkData.slice(0, 30).map(d => ({ symbol: d.symbol, client: d.clientName, transaction: d.buySell, quantity: d.quantityTraded, price: d.tradePrice })), block_deals: blockData.slice(0, 30).map(d => ({ symbol: d.symbol, client: d.clientName, transaction: d.buySell, quantity: d.quantityTraded, price: d.tradePrice })) };
}

async function handle_get_shareholding_pattern({ symbol }) {
  const sym = symbol.toUpperCase();
  const data = await nseGet(`https://www.nseindia.com/api/corp-info?symbol=${sym}&corpType=shareholding&market=equities`);
  return { symbol: sym, shareholding: (data?.shareholdingData || []).slice(0, 8) };
}

async function handle_get_fii_dii_data({ date }) {
  const data = await nseGet('https://www.nseindia.com/api/fiidiiTradeReact');
  return { date: date || 'latest', fii_dii_activity: (data || []).slice(0, 10) };
}

async function handle_get_stock_quote({ symbol }) {
  const sym = symbol.toUpperCase();
  const data = await nseGet(`https://www.nseindia.com/api/quote-equity?symbol=${sym}`);
  const p = data?.priceInfo || {}; const m = data?.metadata || {};
  return { symbol: sym, company_name: m.companyName, last_price: p.lastPrice, open: p.open, high: p.intraDayHighLow?.max, low: p.intraDayHighLow?.min, change_percent: p.pChange, week_52_high: p.weekHighLow?.max, week_52_low: p.weekHighLow?.min, upper_circuit: p.upperCP, lower_circuit: p.lowerCP, vwap: p.vwap };
}

async function handle_get_market_status() {
  const [indices, gainers, losers] = await Promise.allSettled([nseGet('https://www.nseindia.com/api/allIndices'), nseGet('https://www.nseindia.com/api/live-analysis-variations?index=gainers&type=large'), nseGet('https://www.nseindia.com/api/live-analysis-variations?index=losers&type=large')]);
  const keyIndices = ['NIFTY 50', 'NIFTY BANK', 'NIFTY MIDCAP 100', 'NIFTY SMALLCAP 100', 'INDIA VIX'];
  return { indices: indices.status === 'fulfilled' ? (indices.value?.data || []).filter(i => keyIndices.includes(i.index)).map(i => ({ index: i.index, last: i.last, change_pct: i.percentChange })) : [], top_gainers: gainers.status === 'fulfilled' ? (gainers.value?.data || []).slice(0, 5).map(g => ({ symbol: g.symbol, change_pct: g.pChange, ltp: g.ltp })) : [], top_losers: losers.status === 'fulfilled' ? (losers.value?.data || []).slice(0, 5).map(l => ({ symbol: l.symbol, change_pct: l.pChange, ltp: l.ltp })) : [] };
}

async function handle_get_upcoming_events({ event_type, days = 30 }) {
  const data = await nseGet('https://www.nseindia.com/api/event-calendar');
  let events = data || [];
  if (event_type) events = events.filter(e => e.purpose?.toLowerCase().includes(event_type.toLowerCase()));
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + days);
  events = events.filter(e => { const d = new Date(e.date); return d >= new Date() && d <= cutoff; });
  return { count: events.length, events: events.slice(0, 50).map(e => ({ symbol: e.symbol, company: e.company, date: e.date, purpose: e.purpose })) };
}

async function handle_get_insider_trading({ symbol }) {
  const sym = symbol.toUpperCase();
  const data = await nseGet(`https://www.nseindia.com/api/corp-info?symbol=${sym}&corpType=sast&market=equities`);
  return { symbol: sym, insider_transactions: (data?.sastData || []).slice(0, 20).map(s => ({ acquirer: s.acqName, transaction_type: s.transactionType, shares: s.noOfShareAcq, date: s.date, post_holding_pct: s.postShareholdingPer })) };
}

async function handle_search_announcements_by_keyword({ keyword, days = 7 }) {
  const topStocks = ['RELIANCE','TCS','INFY','HDFCBANK','ICICIBANK','SBIN','BAJFINANCE','TATAMOTORS','AXISBANK','WIPRO'];
  const kw = keyword.toLowerCase(); const results = [];
  await Promise.allSettled(topStocks.map(sym => nseGet(`https://www.nseindia.com/api/corp-info?symbol=${sym}&corpType=announcements&market=equities`).then(data => { (data?.corpAnnouncementData || []).forEach(a => { if ((a.desc || '').toLowerCase().includes(kw)) results.push({ symbol: sym, date: a.exchdisstime, subject: a.desc }); }); }).catch(() => {})));
  return { keyword, matches: results.length, results: results.slice(0, 20) };
}

app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: { serverInfo: { name: 'nse-bse-mcp', version: '1.0.0' } } })}\n\n`);
  req.on('close', () => res.end());
});

app.post('/mcp', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { method, params, id } = req.body;
  try {
    if (method === 'initialize') return res.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'nse-bse-mcp', version: '1.0.0' }, capabilities: { tools: {} } } });
    if (method === 'tools/list') return res.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      const handlers = { get_corporate_announcements: handle_get_corporate_announcements, get_result_dates: handle_get_result_dates, get_bulk_block_deals: handle_get_bulk_block_deals, get_shareholding_pattern: handle_get_shareholding_pattern, get_fii_dii_data: handle_get_fii_dii_data, get_stock_quote: handle_get_stock_quote, get_market_status: handle_get_market_status, get_upcoming_events: handle_get_upcoming_events, get_insider_trading: handle_get_insider_trading, search_announcements_by_keyword: handle_search_announcements_by_keyword };
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown tool: ${name}`);
      const result = await handler(args || {});
      return res.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
    }
    if (method?.startsWith('notifications/')) return res.status(204).end();
    res.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    res.json({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});

app.options('/mcp', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(204).end();
});

app.get('/health', (req, res) => res.json({ status: 'ok', server: 'nse-bse-mcp', tools: TOOLS.length, timestamp: new Date().toISOString() }));

getNSECookies().then(() => console.log('NSE cookies initialized'));

const PORT = process.env.PORT || 3005;
app.listen(PORT, () => console.log(`NSE/BSE MCP Server running on port ${PORT}`));
