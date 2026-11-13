const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sign(payload, secret) {
  const encoded = base64url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encoded));
  return encoded + "." + base64url(new Uint8Array(signature));
}

async function verify(token, secret) {
  try {
    if (!secret || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encoded, signature] = parts;
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const padded = signature.replace(/-/g, "+").replace(/_/g, "/");
    const sigBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "HMAC", key, sigBytes, encoder.encode(encoded)
    );
    if (!valid) return null;
    const payloadText = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadText);
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function deviceInfo(ua) {
  let device = "Desktop";
  if (/ipad|tablet|kindle|silk/i.test(ua)) device = "Tablet";
  else if (/mobile|android|iphone|ipod/i.test(ua)) device = "Mobile";

  let browser = "Other";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";

  let os = "Other";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/mac os|macintosh/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  return { device, browser, os };
}

function safeText(value, max = 500) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

async function requireAdmin(request, env) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const payload = await verify(token, env.SESSION_SECRET);
  return payload?.role === "admin" ? payload : null;
}

const trackerJS = String.raw`
(function () {
  var current = document.currentScript || document.querySelector("script[data-project-id]");
  if (!current) return;

  var projectId = current.getAttribute("data-project-id");
  if (!projectId) return;

  var endpoint = current.src ? new URL("/collect", current.src).href : "/collect";
  var storageKey = "vt_visitor_" + projectId;
  var visitorId = null;

  try {
    var match = document.cookie.match(new RegExp("(?:^|; )" + storageKey + "=([^;]*)"));
    visitorId = match ? decodeURIComponent(match[1]) : null;
  } catch (_) {}

  if (!visitorId) {
    try {
      visitorId = localStorage.getItem(storageKey);
    } catch (_) {}
  }

  if (!visitorId) {
    if (window.crypto && crypto.randomUUID) {
      visitorId = crypto.randomUUID();
    } else {
      visitorId = "v-" + Date.now().toString(36) + "-" +
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    try {
      var secureFlag = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = storageKey + "=" + encodeURIComponent(visitorId) +
        "; path=/; max-age=31536000; SameSite=Lax" + secureFlag;
    } catch (_) {}
    try {
      localStorage.setItem(storageKey, visitorId);
    } catch (_) {}
  }

  var payload = {
    projectId: projectId,
    visitorId: visitorId,
    pageUrl: location.href,
    referrer: document.referrer || "",
    screen: (screen.width || 0) + "x" + (screen.height || 0),
    utm_source: new URLSearchParams(location.search).get("utm_source") || "",
    utm_medium: new URLSearchParams(location.search).get("utm_medium") || "",
    utm_campaign: new URLSearchParams(location.search).get("utm_campaign") || ""
  };

  try {
    fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(function () {});
  } catch (_) {}
})();
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === "/health" && method === "GET") {
        return json({ ok: true, service: "visitor-tracker" });
      }

      if (path === "/tracker.js" && method === "GET") {
        return new Response(trackerJS, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      // Public collection endpoint. IP is read from Cloudflare's edge header,
      // never from visitor-supplied JSON. Supports CORS preflight (OPTIONS).
      if (path === "/collect") {
        const originHeader = request.headers.get("Origin") || "*";
        const corsHeaders = {
          "Access-Control-Allow-Origin": originHeader,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400"
        };

        if (method === "OPTIONS") {
          return new Response(null, { status: 204, headers: corsHeaders });
        }

        if (method !== "POST") {
          return new Response(null, { status: 405, headers: corsHeaders });
        }

        let origin = request.headers.get("Origin");
        if (!origin && request.headers.get("Referer")) {
          try { origin = new URL(request.headers.get("Referer")).origin; } catch (_) {}
        }
        if (!origin) return new Response(null, { status: 204, headers: corsHeaders });

        let body;
        try {
          body = await request.json();
        } catch {
          return new Response(null, { status: 204, headers: corsHeaders });
        }

        if (
          typeof body.projectId !== "string" ||
          !/^[a-f0-9-]{16,64}$/i.test(body.projectId) ||
          typeof body.visitorId !== "string" ||
          !/^[a-z0-9_-]{16,100}$/i.test(body.visitorId)
        ) return new Response(null, { status: 204, headers: corsHeaders });

        const project = await env.DB.prepare(
          "SELECT id, allowed_origin FROM projects WHERE id = ? AND active = 1"
        ).bind(body.projectId).first();

        if (!project || origin.toLowerCase() !== project.allowed_origin.toLowerCase()) {
          return new Response(null, { status: 204, headers: corsHeaders });
        }

        let page;
        try {
          page = new URL(body.pageUrl);
          if (page.origin.toLowerCase() !== project.allowed_origin.toLowerCase()) throw new Error("origin mismatch");
        } catch {
          return new Response(null, { status: 204, headers: corsHeaders });
        }

        const ua = request.headers.get("User-Agent") || "";
        const info = deviceInfo(ua);
        const cf = request.cf || {};
        const ip = request.headers.get("CF-Connecting-IP") ||
          request.headers.get("x-real-ip") ||
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "127.0.0.1";

        await env.DB.prepare(`
          INSERT INTO visits (
            project_id, visitor_id, ip_address, device, browser,
            operating_system, country, region, city, page_url,
            referrer, screen_resolution, utm_source, utm_medium, utm_campaign
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          project.id,
          body.visitorId,
          ip,
          info.device,
          info.browser,
          info.os,
          cf.country || null,
          cf.region || null,
          cf.city || null,
          page.href.slice(0, 2000),
          safeText(body.referrer, 2000),
          safeText(body.screen, 30),
          safeText(body.utm_source, 300),
          safeText(body.utm_medium, 300),
          safeText(body.utm_campaign, 300)
        ).run();

        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (path === "/api/login" && method === "POST") {
        if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
          return json({ error: "Set ADMIN_PASSWORD and SESSION_SECRET first" }, 500);
        }
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        if (typeof body.password !== "string" || body.password !== env.ADMIN_PASSWORD) {
          return json({ error: "Incorrect password" }, 401);
        }
        const token = await sign({
          role: "admin",
          exp: Date.now() + 12 * 60 * 60 * 1000
        }, env.SESSION_SECRET);
        return json({ token });
      }

      if (path.startsWith("/api/")) {
        const auth = await requireAdmin(request, env);
        if (!auth) return json({ error: "Unauthorized" }, 401);
      }

      if (path === "/api/projects" && method === "GET") {
        const result = await env.DB.prepare(`
          SELECT p.*,
            (SELECT COUNT(*) FROM visits v WHERE v.project_id=p.id) AS total_visits,
            (SELECT COUNT(DISTINCT visitor_id) FROM visits v WHERE v.project_id=p.id) AS unique_visitors
          FROM projects p ORDER BY p.created_at DESC
        `).all();
        return json(result.results);
      }

      if (path === "/api/projects" && method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        if (!body.name || !body.landingUrl) {
          return json({ error: "Project name and landing URL are required" }, 400);
        }

        let landing;
        try {
          landing = new URL(body.landingUrl);
          if (!["https:", "http:"].includes(landing.protocol)) throw new Error();
        } catch {
          return json({ error: "Enter a valid http/https landing page URL" }, 400);
        }

        const id = crypto.randomUUID().replace(/-/g, "");
        await env.DB.prepare(`
          INSERT INTO projects (id, name, landing_url, allowed_origin)
          VALUES (?, ?, ?, ?)
        `).bind(
          id,
          safeText(body.name, 150),
          landing.href,
          landing.origin
        ).run();

        return json({ id, name: safeText(body.name, 150), landingUrl: landing.href });
      }

      if (path.startsWith("/api/projects/") && method === "PATCH") {
        const id = path.split("/").pop();
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
        await env.DB.prepare(
          "UPDATE projects SET active = ? WHERE id = ?"
        ).bind(body.active ? 1 : 0, id).run();
        return json({ success: true });
      }

      if (path === "/api/stats" && method === "GET") {
        const projectId = url.searchParams.get("projectId") || "";
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") || 7)));
        if (!/^[a-f0-9-]{16,64}$/i.test(projectId)) {
          return json({ error: "Select a valid project" }, 400);
        }
        const since = new Date(Date.now() - days * 86400000).toISOString();

        const stats = await env.DB.prepare(`
          SELECT
            COUNT(*) AS total_visits,
            COUNT(DISTINCT visitor_id) AS unique_visitors,
            COUNT(DISTINCT ip_address) AS unique_ips,
            COUNT(DISTINCT CASE WHEN date(visited_at) = date('now') THEN visitor_id END) AS today_visitors,
            COUNT(CASE WHEN date(visited_at) = date('now') THEN 1 END) AS today_visits,
            (
              SELECT COUNT(DISTINCT v2.visitor_id)
              FROM visits v2
              WHERE v2.project_id = ?
                AND datetime(v2.visited_at) >= datetime(?)
                AND (
                  SELECT COUNT(*) FROM visits v3
                  WHERE v3.project_id = v2.project_id AND v3.visitor_id = v2.visitor_id
                ) > 1
            ) AS returning_visitors
          FROM visits
          WHERE project_id = ? AND datetime(visited_at) >= datetime(?)
        `).bind(projectId, since, projectId, since).first();

        const devices = await env.DB.prepare(`
          SELECT device, COUNT(*) AS total
          FROM visits WHERE project_id = ? AND datetime(visited_at) >= datetime(?)
          GROUP BY device ORDER BY total DESC
        `).bind(projectId, since).all();

        const browsers = await env.DB.prepare(`
          SELECT browser, COUNT(*) AS total
          FROM visits WHERE project_id = ? AND datetime(visited_at) >= datetime(?)
          GROUP BY browser ORDER BY total DESC
        `).bind(projectId, since).all();

        const operatingSystems = await env.DB.prepare(`
          SELECT operating_system, COUNT(*) AS total
          FROM visits WHERE project_id = ? AND datetime(visited_at) >= datetime(?)
          GROUP BY operating_system ORDER BY total DESC
        `).bind(projectId, since).all();

        const daily = await env.DB.prepare(`
          SELECT substr(visited_at,1,10) AS date, COUNT(*) AS total
          FROM visits WHERE project_id = ? AND datetime(visited_at) >= datetime(?)
          GROUP BY date ORDER BY date DESC
        `).bind(projectId, since).all();

        return json({
          stats,
          devices: devices.results,
          browsers: browsers.results,
          operatingSystems: operatingSystems.results,
          daily: daily.results
        });
      }

      if (path === "/api/visitors" && method === "GET") {
        const projectId = url.searchParams.get("projectId") || "";
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
        if (!/^[a-f0-9-]{16,64}$/i.test(projectId)) {
          return json({ error: "Select a valid project" }, 400);
        }

        const result = await env.DB.prepare(`
          SELECT
            visitor_id, ip_address,
            MAX(device) AS device,
            MAX(browser) AS browser,
            MAX(operating_system) AS operating_system,
            MAX(country) AS country,
            MAX(region) AS region,
            MAX(city) AS city,
            MIN(visited_at) AS first_visit,
            MAX(visited_at) AS last_visit,
            COUNT(*) AS total_visits
          FROM visits
          WHERE project_id = ?
          GROUP BY visitor_id, ip_address
          ORDER BY last_visit DESC
          LIMIT ?
        `).bind(projectId, limit).all();

        return json(result.results);
      }

      if (path === "/" || path === "/admin" || path === "/admin.html") {
        return env.ASSETS.fetch(new Request(new URL("/admin.html", request.url)));
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Visitor Tracker Error:", error);
      return json({ error: "Internal server error" }, 500);
    }
  }
};
