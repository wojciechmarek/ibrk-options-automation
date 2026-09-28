import cron from "node-cron";
import { config } from "./config";
import { fetchGreeks } from "./ib";
import { fetchFlex } from "./flex";
import { appendGreeks, writeFlex } from "./sheets";

async function job() {
  const ts = new Date();
  console.log(`[${ts.toISOString()}] start`);

  const tasks: [string, () => Promise<void>][] = [
    ["greeks", async () => {
      const { legs, totals } = await fetchGreeks();
      await appendGreeks(ts, legs, totals);
      console.log(`greeks: ${legs.length} nóg, ${totals.length} instrumentów`);
    }],
  ];
  if (config.flexToken && config.flexQueryId) {
    tasks.push(["flex", async () => {
      const tables = await fetchFlex();
      await writeFlex(tables);
      console.log(`flex: tabele: ${Object.keys(tables).join(", ") || "brak"}`);
    }]);
  }

  // Awaria jednego źródła nie blokuje drugiego
  const results = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  results.forEach((r, i) =>
    console.log(r.status === "fulfilled" ? `OK   ${tasks[i][0]}` : `FAIL ${tasks[i][0]}: ${r.reason}`)
  );
}

async function main() {
  if (config.runNow) await job();
  cron.schedule(config.cron, () => { job().catch(console.error); }, { timezone: config.tz });
  console.log(`Harmonogram: "${config.cron}" (${config.tz})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
