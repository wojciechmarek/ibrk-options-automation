import { XMLParser } from "fast-xml-parser";
import { config } from "./config";

const BASE = "https://gdcdyn.interactivebrokers.com/Universal/servlet";
const HEADERS = { "User-Agent": "ibkr-sheets/1.0" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
});

const toArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export type FlexTables = Record<string, Record<string, string>[]>;

async function sendRequest(): Promise<string> {
  const url = `${BASE}/FlexStatementService.SendRequest?t=${config.flexToken}&q=${config.flexQueryId}&v=3`;
  const xml = await (await fetch(url, { headers: HEADERS })).text();
  const r = parser.parse(xml).FlexStatementResponse;
  if (!r || r.Status !== "Success") {
    throw new Error(`Flex SendRequest: ${r?.ErrorCode ?? "?"} ${r?.ErrorMessage ?? xml.slice(0, 200)}`);
  }
  return String(r.ReferenceCode);
}

async function getStatement(ref: string): Promise<string> {
  const url = `${BASE}/FlexStatementService.GetStatement?t=${config.flexToken}&q=${ref}&v=3`;
  for (let i = 0; i < 12; i++) {
    const xml = await (await fetch(url, { headers: HEADERS })).text();
    if (xml.includes("<FlexQueryResponse")) return xml;
    const r = parser.parse(xml).FlexStatementResponse;
    // 1019 = raport jest jeszcze generowany
    if (r?.ErrorCode === "1019") {
      await sleep(10_000);
      continue;
    }
    throw new Error(`Flex GetStatement: ${r?.ErrorCode ?? "?"} ${r?.ErrorMessage ?? xml.slice(0, 200)}`);
  }
  throw new Error("Flex: raport nie został wygenerowany w wyznaczonym czasie");
}

// Każdy typ elementu z każdej sekcji raportu (np. Trades/Trade) staje się osobną tabelą.
function toTables(xml: string): FlexTables {
  const doc = parser.parse(xml);
  const statements = toArray<any>(doc.FlexQueryResponse?.FlexStatements?.FlexStatement);
  const tables: FlexTables = {};
  for (const st of statements) {
    for (const [section, sectionVal] of Object.entries<any>(st)) {
      if (typeof sectionVal !== "object" || sectionVal === null) continue; // atrybut statementu
      for (const [item, items] of Object.entries<any>(sectionVal)) {
        const rows = toArray<any>(items)
          .filter((x) => typeof x === "object" && x !== null)
          .map((x) => {
            const flat: Record<string, string> = {};
            for (const [k, v] of Object.entries(x)) if (typeof v !== "object") flat[k] = String(v);
            return flat;
          });
        if (rows.length) (tables[`${section}_${item}`] ??= []).push(...rows);
      }
    }
  }
  return tables;
}

export async function fetchFlex(): Promise<FlexTables> {
  const ref = await sendRequest();
  await sleep(5_000);
  const xml = await getStatement(ref);
  return toTables(xml);
}
