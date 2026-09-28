function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return v;
}

export const config = {
  ibHost: process.env.IB_HOST ?? "ib-gateway",
  ibPort: Number(process.env.IB_PORT ?? 4004),
  cron: process.env.CRON ?? "0 22 * * *",
  tz: process.env.TZ ?? "Europe/Warsaw",
  sheetId: req("GOOGLE_SHEET_ID"),
  googleSaB64: req("GOOGLE_SA_B64"),
  flexToken: process.env.FLEX_TOKEN || "",
  flexQueryId: process.env.FLEX_QUERY_ID || "",
  flexMode: (process.env.FLEX_MODE ?? "replace") as "replace" | "append",
  runNow: process.env.RUN_NOW === "1",
};
