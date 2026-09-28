import { IBApi, EventName, Contract } from "@stoqey/ib";
import { config } from "./config";

export interface Leg {
  account: string;
  symbol: string;
  localSymbol: string;
  expiry: string;
  strike: number | null;
  right: string;
  position: number;
  multiplier: number;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  undPrice: number | null;
  posDelta: number | null;
  posGamma: number | null;
  posTheta: number | null;
  posVega: number | null;
}

export interface Totals {
  symbol: string;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

// Numery pól ticków z modelowymi grekami: 13 = MODEL_OPTION, 83 = DELAYED_MODEL_OPTION
const MODEL_FIELDS = [13, 83];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// IB oznacza brak wartości jako undefined / DBL_MAX / -1 (dla IV)
const clean = (v: unknown): number | null =>
  typeof v === "number" && isFinite(v) && Math.abs(v) < 1e100 ? v : null;

async function connect(): Promise<IBApi> {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const ib = new IBApi({ host: config.ibHost, port: config.ibPort, clientId: 11 });
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout połączenia")), 20_000);
        ib.once(EventName.connected, () => {
          clearTimeout(t);
          resolve();
        });
        ib.connect();
      });
      return ib;
    } catch (e) {
      console.log(`Połączenie z Gateway nieudane (${attempt}/10): ${e}`);
      try { ib.disconnect(); } catch {}
      await sleep(30_000); // Gateway może się dopiero uruchamiać
    }
  }
  throw new Error("Nie udało się połączyć z IB Gateway");
}

function getPositions(ib: IBApi): Promise<{ account: string; contract: Contract; pos: number }[]> {
  return new Promise((resolve) => {
    const out: { account: string; contract: Contract; pos: number }[] = [];
    const onPos = (account: string, contract: Contract, pos: number) => {
      out.push({ account, contract, pos });
    };
    ib.on(EventName.position, onPos);
    ib.once(EventName.positionEnd, () => {
      ib.off(EventName.position, onPos);
      ib.cancelPositions();
      resolve(out);
    });
    ib.reqPositions();
  });
}

interface Model {
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  theta: number | null;
  undPrice: number | null;
}

function getModelGreeks(ib: IBApi, reqId: number, contract: Contract): Promise<Model | null> {
  return new Promise((resolve) => {
    const finish = (m: Model | null) => {
      clearTimeout(timer);
      ib.off(EventName.tickOptionComputation, handler as any);
      try { ib.cancelMktData(reqId); } catch {}
      resolve(m);
    };

    // Sygnatura zdarzenia różni się między wersjami biblioteki (w nowszych jest dodatkowy
    // parametr tickAttrib po "field"), więc odczytujemy argumenty pozycyjnie.
    const handler = (...args: any[]) => {
      if (args[0] !== reqId || !MODEL_FIELDS.includes(args[1])) return;
      const o = args.length >= 11 ? 3 : 2;
      const [iv, delta, , , gamma, vega, theta, und] = args.slice(o);
      const m: Model = {
        iv: clean(iv),
        delta: clean(delta),
        gamma: clean(gamma),
        vega: clean(vega),
        theta: clean(theta),
        undPrice: clean(und),
      };
      if (m.delta !== null) finish(m);
    };

    const timer = setTimeout(() => finish(null), 20_000);
    ib.on(EventName.tickOptionComputation, handler as any);
    ib.reqMktData(reqId, { ...contract, exchange: contract.exchange || "SMART" }, "", false, false);
  });
}

export async function fetchGreeks(): Promise<{ legs: Leg[]; totals: Totals[] }> {
  const ib = await connect();
  try {
    // 2 = frozen (ostatnie notowania po zamknięciu rynku). Gdy brak subskrypcji danych, zmień na 4 (delayed frozen).
    ib.reqMarketDataType(2);

    const positions = (await getPositions(ib)).filter(
      (p) => p.contract.secType === "OPT" && p.pos !== 0
    );

    const legs: Leg[] = await Promise.all(
      positions.map(async (p, i) => {
        const c = p.contract;
        const mult = Number(c.multiplier ?? 100) || 100;
        const m = await getModelGreeks(ib, 1000 + i, c);
        const pos = (g: number | null | undefined) =>
          g === null || g === undefined ? null : g * p.pos * mult;
        return {
          account: p.account,
          symbol: c.symbol ?? "",
          localSymbol: c.localSymbol ?? "",
          expiry: c.lastTradeDateOrContractMonth ?? "",
          strike: c.strike ?? null,
          right: String(c.right ?? ""),
          position: p.pos,
          multiplier: mult,
          iv: m?.iv ?? null,
          delta: m?.delta ?? null,
          gamma: m?.gamma ?? null,
          theta: m?.theta ?? null,
          vega: m?.vega ?? null,
          undPrice: m?.undPrice ?? null,
          posDelta: pos(m?.delta),
          posGamma: pos(m?.gamma),
          posTheta: pos(m?.theta),
          posVega: pos(m?.vega),
        };
      })
    );

    // Spread = suma nóg. Grupujemy po instrumencie bazowym.
    const map = new Map<string, Totals>();
    for (const l of legs) {
      const t = map.get(l.symbol) ?? { symbol: l.symbol, delta: 0, gamma: 0, theta: 0, vega: 0 };
      t.delta += l.posDelta ?? 0;
      t.gamma += l.posGamma ?? 0;
      t.theta += l.posTheta ?? 0;
      t.vega += l.posVega ?? 0;
      map.set(l.symbol, t);
    }
    return { legs, totals: [...map.values()] };
  } finally {
    ib.disconnect();
  }
}
