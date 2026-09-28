import { google } from "googleapis";
import { config } from "./config";
import type { Leg, Totals } from "./ib";
import type { FlexTables } from "./flex";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(Buffer.from(config.googleSaB64, "base64").toString("utf8")),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });
const spreadsheetId = config.sheetId;

type Cell = string | number | null;

async function ensureTab(title: string) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  if (!meta.data.sheets?.some((s) => s.properties?.title === title)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
}

const cells = (row: Cell[]) => row.map((c) => (c === null ? "" : c));

async function append(title: string, header: string[], rows: Cell[][]) {
  if (!rows.length) return;
  await ensureTab(title);
  const first = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${title}!A1:A1` });
  const values = first.data.values?.length ? rows : [header, ...rows];
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${title}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: values.map(cells) },
  });
}

export async function appendGreeks(ts: Date, legs: Leg[], totals: Totals[]) {
  const stamp = ts.toLocaleString("sv-SE", { timeZone: config.tz }); // 2026-09-28 22:00:00

  await append(
    "Greeks_Legs",
    ["timestamp", "account", "symbol", "local_symbol", "expiry", "strike", "right", "position", "multiplier",
     "iv", "delta", "gamma", "theta", "vega", "underlying_price",
     "pos_delta", "pos_gamma", "pos_theta", "pos_vega"],
    legs.map((l) => [stamp, l.account, l.symbol, l.localSymbol, l.expiry, l.strike, l.right, l.position,
      l.multiplier, l.iv, l.delta, l.gamma, l.theta, l.vega, l.undPrice,
      l.posDelta, l.posGamma, l.posTheta, l.posVega])
  );

  await append(
    "Greeks_Totals",
    ["timestamp", "symbol", "delta", "gamma", "theta", "vega"],
    totals.map((t) => [stamp, t.symbol, t.delta, t.gamma, t.theta, t.vega])
  );
}

export async function writeFlex(tables: FlexTables) {
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: config.tz });
  for (const [name, rows] of Object.entries(tables)) {
    const title = `Flex_${name}`.slice(0, 99);
    const header = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const data: Cell[][] = rows.map((r) => header.map((h) => r[h] ?? ""));

    if (config.flexMode === "append") {
      await append(title, ["fetched_at", ...header], data.map((r) => [stamp, ...r]));
    } else {
      await ensureTab(title);
      await sheets.spreadsheets.values.clear({ spreadsheetId, range: title });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${title}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [header, ...data].map(cells) },
      });
    }
  }
}
