import type { FastifyInstance } from "fastify";
import { fetchReserves } from "../services/reserves.js";

export async function badgeRoute(app: FastifyInstance) {
  app.get("/badge", async (_req, reply) => {
    let ratioText = "—";
    let color = "#6b7280";
    let alertText = "";

    try {
      const data = await fetchReserves();
      const pct = (data.ratio * 100).toFixed(2);
      ratioText = pct + "%";
      color = data.ratio >= 0.99 ? "#16a34a" : "#dc2626";
      alertText = data.ratio < 0.99 ? " ⚠" : " ✓";
    } catch {
      alertText = " ✗";
    }

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta http-equiv="refresh" content="300"/>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:transparent}
  .badge{display:inline-flex;align-items:center;gap:6px;background:#1e40af;
         color:#fff;border-radius:6px;padding:4px 10px;font-size:13px;font-weight:600}
  .ratio{color:${color};background:#fff;border-radius:4px;padding:1px 6px;font-size:13px}
</style>
</head>
<body>
<div class="badge">
  IDRX Reserve <span class="ratio">${ratioText}${alertText}</span>
</div>
</body>
</html>`;

    reply
      .header("Content-Type", "text/html; charset=utf-8")
      .header("X-Frame-Options", "ALLOWALL")
      .header("Cache-Control", "public, max-age=300")
      .send(html);
  });
}
