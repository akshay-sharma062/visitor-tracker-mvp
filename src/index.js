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

function originsMatch(a, b) {
  if (!a || !b) return false;
  try {
    const uA = new URL(a.startsWith("http") ? a : "https://" + a);
    const uB = new URL(b.startsWith("http") ? b : "https://" + b);
    const hostA = uA.hostname.replace(/^www\./i, "").toLowerCase();
    const hostB = uB.hostname.replace(/^www\./i, "").toLowerCase();
    return uA.protocol === uB.protocol && hostA === hostB && (uA.port || "") === (uB.port || "");
  } catch {
    return a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
  }
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    diff |= bufA[i] ^ bufB[i];
  }
  return diff === 0;
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
  var scriptEventType = current.getAttribute("data-event-type");

  // 1. Persistent Visitor ID (Cookie + localStorage)
  var visitorKey = "vt_visitor_" + projectId;
  var visitorId = null;

  try {
    var matchV = document.cookie.match(new RegExp("(?:^|; )" + visitorKey + "=([^;]*)"));
    visitorId = matchV ? decodeURIComponent(matchV[1]) : null;
  } catch (_) {}

  if (!visitorId) {
    try {
      visitorId = localStorage.getItem(visitorKey);
    } catch (_) {}
  }

  if (!visitorId) {
    if (window.crypto && crypto.randomUUID) {
      visitorId = crypto.randomUUID();
    } else {
      visitorId = "v-" + Date.now().toString(36) + "-" +
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
  }

  // Ensure visitorId is synchronized across both cookie and localStorage
  try {
    var sec = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = visitorKey + "=" + encodeURIComponent(visitorId) +
      "; path=/; max-age=31536000; SameSite=Lax" + sec;
  } catch (_) {}
  try {
    localStorage.setItem(visitorKey, visitorId);
  } catch (_) {}

  // 2. Session ID (sessionStorage + session cookie)
  var sessionKey = "vt_session_" + projectId;
  var sessionId = null;

  try {
    sessionId = sessionStorage.getItem(sessionKey);
  } catch (_) {}

  if (!sessionId) {
    try {
      var matchS = document.cookie.match(new RegExp("(?:^|; )" + sessionKey + "=([^;]*)"));
      sessionId = matchS ? decodeURIComponent(matchS[1]) : null;
    } catch (_) {}
  }

  if (!sessionId) {
    if (window.crypto && crypto.randomUUID) {
      sessionId = crypto.randomUUID();
    } else {
      sessionId = "s-" + Date.now().toString(36) + "-" +
        Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
  }

  try {
    sessionStorage.setItem(sessionKey, sessionId);
  } catch (_) {}
  try {
    var secS = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = sessionKey + "=" + encodeURIComponent(sessionId) +
      "; path=/; max-age=1800; SameSite=Lax" + secS;
  } catch (_) {}

  // 3. Reusable Beacon Sender
  function sendBeacon(eventType, extra) {
    var eventId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : ("e-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2));

    var payload = {
      projectId: projectId,
      visitorId: visitorId,
      sessionId: sessionId,
      eventType: eventType || "pageview",
      eventId: eventId,
      pageUrl: location.href,
      referrer: document.referrer || "",
      screen: (screen.width || 0) + "x" + (screen.height || 0),
      utm_source: new URLSearchParams(location.search).get("utm_source") || "",
      utm_medium: new URLSearchParams(location.search).get("utm_medium") || "",
      utm_campaign: new URLSearchParams(location.search).get("utm_campaign") || ""
    };

    if (extra && typeof extra === "object") {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) {
          payload[k] = extra[k];
        }
      }
    }

    try {
      fetch(endpoint, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(function () {});
    } catch (_) {}
    return eventId;
  }

  // 4. Determine Initial Page Event (pageview vs thank-you page lead)
  var isThankYouPage = false;
  var path = location.pathname.toLowerCase();
  if (
    scriptEventType === "lead" ||
    path.indexOf("/3zx0t3gz") !== -1 ||
    /(thank|thanks|success|confirmed|confirmation)/i.test(path)
  ) {
    isThankYouPage = true;
  }

  var leadSentKey = "vt_lead_sent_" + projectId;
  if (isThankYouPage) {
    var alreadySent = false;
    try {
      alreadySent = !!sessionStorage.getItem(leadSentKey);
    } catch (_) {}

    if (!alreadySent) {
      sendBeacon("lead");
      try {
        sessionStorage.setItem(leadSentKey, "1");
      } catch (_) {}
    } else {
      // If refreshed, send a pageview so page views are counted without duplicating leads
      sendBeacon("pageview");
    }
  } else {
    // Standard landing page pageview
    sendBeacon("pageview");
  }

  // 5. FlexiFunnels Form Interception (on Landing Page)
  var leadDispatched = false;
  function triggerLead(source) {
    if (leadDispatched) return;
    leadDispatched = true;
    sendBeacon("lead", { leadSource: source || "form" });
    try {
      sessionStorage.setItem(leadSentKey, "1");
    } catch (_) {}
  }

  // Hook standard DOM submit
  document.addEventListener("submit", function () {
    triggerLead("submit");
  }, true);

  // Hook FlexiFunnels submit buttons
  document.addEventListener("click", function (e) {
    try {
      var target = e.target;
      if (!target) return;
      var btn = target.closest ? target.closest("button[type='submit'], input[type='submit'], .flexi-submit-btn, [data-form-submit]") : null;
      if (btn) {
        triggerLead("click");
      }
    } catch (_) {}
  }, true);

  // Hook jQuery ajaxSuccess for FlexiFunnels ft-control.js
  if (typeof window.jQuery !== "undefined") {
    try {
      window.jQuery(document).ajaxSuccess(function (evt, xhr, settings) {
        if (settings && settings.url && (
          settings.url.indexOf("contact_submission") !== -1 ||
          settings.url.indexOf("lead") !== -1 ||
          settings.url.indexOf("form") !== -1 ||
          settings.url.indexOf("admin-ajax") !== -1
        )) {
          triggerLead("ajaxSuccess");
        }
      });
    } catch (_) {}
  }

  // 6. Global Helper for manual invocation
  window.VisitorTracker = {
    trackLead: function (extra) {
      triggerLead("manual");
    },
    trackPageView: function (extra) {
      sendBeacon("pageview", extra);
    },
    getVisitorId: function () { return visitorId; },
    getSessionId: function () { return sessionId; }
  };
})();
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cleanPath = path.replace(/\/+$/, "") || "/";
    const method = request.method;

    try {
      if (cleanPath === "/health" && method === "GET") {
        return json({ ok: true, service: "visitor-tracker" });
      }

      if (cleanPath === "/tracker.js" && method === "GET") {
        return new Response(trackerJS, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "public, max-age=300",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      // Public collection endpoint
      if (cleanPath === "/collect") {
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

        if (!project || !originsMatch(origin, project.allowed_origin)) {
          return new Response(null, { status: 204, headers: corsHeaders });
        }

        let page;
        try {
          page = new URL(body.pageUrl);
          if (!originsMatch(page.origin, project.allowed_origin)) throw new Error("origin mismatch");
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

        const eventType = body.eventType === "lead" ? "lead" : "pageview";
        const eventId = typeof body.eventId === "string" && body.eventId.length >= 8
          ? body.eventId.slice(0, 100)
          : crypto.randomUUID();
        const sessionId = typeof body.sessionId === "string" && body.sessionId.length >= 8
          ? body.sessionId.slice(0, 100)
          : null;

        await env.DB.prepare(`
          INSERT OR IGNORE INTO visits (
            project_id, visitor_id, session_id, event_type, event_id,
            ip_address, device, browser,
            operating_system, country, region, city, page_url,
            referrer, screen_resolution, utm_source, utm_medium, utm_campaign
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          project.id,
          body.visitorId,
          sessionId,
          eventType,
          eventId,
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

      if (cleanPath === "/api/login") {
        if (method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization"
            }
          });
        }
        if (method !== "POST") {
          return json({ error: "Method not allowed" }, 405);
        }
        if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 16) {
          return json({ error: "Set ADMIN_PASSWORD and strong SESSION_SECRET (at least 16 chars) first" }, 500);
        }
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON in request body" }, 400); }
        if (typeof body.password !== "string" || !timingSafeEqual(body.password, env.ADMIN_PASSWORD)) {
          return json({ error: "Incorrect password" }, 401);
        }
        const token = await sign({
          role: "admin",
          exp: Date.now() + 12 * 60 * 60 * 1000
        }, env.SESSION_SECRET);
        return json({ token });
      }

      if (cleanPath.startsWith("/api/")) {
        if (method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization"
            }
          });
        }
        const auth = await requireAdmin(request, env);
        if (!auth) return json({ error: "Unauthorized" }, 401);
      }

      if (cleanPath === "/api/projects" && method === "GET") {
        const result = await env.DB.prepare(`
          SELECT p.*,
            (SELECT COUNT(*) FROM visits v WHERE v.project_id=p.id AND (v.event_type = 'pageview' OR v.event_type IS NULL)) AS total_pageviews,
            (SELECT COUNT(*) FROM visits v WHERE v.project_id=p.id AND v.event_type = 'lead') AS total_leads,
            (SELECT COUNT(*) FROM visits v WHERE v.project_id=p.id) AS total_visits,
            (SELECT COUNT(DISTINCT visitor_id) FROM visits v WHERE v.project_id=p.id) AS unique_visitors
          FROM projects p ORDER BY p.created_at DESC
        `).all();
        return json(result.results);
      }

      if (cleanPath === "/api/projects" && method === "POST") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON in request body" }, 400); }
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

      if (cleanPath.startsWith("/api/projects/") && method === "PATCH") {
        const id = cleanPath.split("/").pop();
        let body;
        try { body = await request.json(); } catch { return json({ error: "Invalid JSON in request body" }, 400); }
        await env.DB.prepare(
          "UPDATE projects SET active = ? WHERE id = ?"
        ).bind(body.active ? 1 : 0, id).run();
        return json({ success: true });
      }

      if (cleanPath === "/api/stats" && method === "GET") {
        const projectId = url.searchParams.get("projectId") || "";
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") || 7)));
        if (!/^[a-f0-9-]{16,64}$/i.test(projectId)) {
          return json({ error: "Select a valid project" }, 400);
        }
        const since = new Date(Date.now() - days * 86400000).toISOString();

        const stats = await env.DB.prepare(`
          SELECT
            COUNT(CASE WHEN event_type = 'pageview' OR event_type IS NULL THEN 1 END) AS total_pageviews,
            COUNT(CASE WHEN event_type = 'lead' THEN 1 END) AS total_leads,
            COUNT(*) AS total_visits,
            COUNT(DISTINCT visitor_id) AS unique_visitors,
            COUNT(DISTINCT COALESCE(session_id, visitor_id)) AS total_sessions,
            COUNT(DISTINCT ip_address) AS unique_ips,
            COUNT(DISTINCT CASE WHEN date(visited_at) = date('now') THEN visitor_id END) AS today_visitors,
            COUNT(CASE WHEN date(visited_at) = date('now') AND (event_type = 'pageview' OR event_type IS NULL) THEN 1 END) AS today_pageviews,
            COUNT(CASE WHEN date(visited_at) = date('now') AND event_type = 'lead' THEN 1 END) AS today_leads,
            (
              SELECT COUNT(DISTINCT visitor_id) FROM visits
              WHERE project_id = ?
                AND datetime(visited_at) >= datetime(?)
                AND visitor_id IN (
                  SELECT visitor_id FROM visits
                  WHERE project_id = ?
                  GROUP BY visitor_id
                  HAVING COUNT(DISTINCT session_id) > 1 OR (COUNT(DISTINCT session_id) = 0 AND COUNT(*) > 1)
                )
            ) AS returning_visitors
          FROM visits
          WHERE project_id = ? AND datetime(visited_at) >= datetime(?)
        `).bind(projectId, since, projectId, projectId, since).first();

        const uVisitors = Number(stats?.unique_visitors || 0);
        const tLeads = Number(stats?.total_leads || 0);
        const conversionRate = uVisitors > 0 ? Number(((tLeads / uVisitors) * 100).toFixed(2)) : 0;

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
          SELECT
            substr(visited_at,1,10) AS date,
            COUNT(CASE WHEN event_type = 'pageview' OR event_type IS NULL THEN 1 END) AS pageviews,
            COUNT(CASE WHEN event_type = 'lead' THEN 1 END) AS leads,
            COUNT(DISTINCT visitor_id) AS unique_visitors,
            COUNT(*) AS total
          FROM visits WHERE project_id = ? AND datetime(visited_at) >= datetime(?)
          GROUP BY date ORDER BY date DESC
        `).bind(projectId, since).all();

        const recentLeads = await env.DB.prepare(`
          SELECT id, visitor_id, session_id, ip_address, device, browser,
                 operating_system, country, region, city, page_url, visited_at
          FROM visits
          WHERE project_id = ? AND event_type = 'lead'
          ORDER BY visited_at DESC
          LIMIT 50
        `).bind(projectId).all();

        return json({
          stats: {
            ...stats,
            conversion_rate: conversionRate
          },
          devices: devices.results,
          browsers: browsers.results,
          operatingSystems: operatingSystems.results,
          daily: daily.results,
          recentLeads: recentLeads.results
        });
      }

      if (cleanPath === "/api/visitors" && method === "GET") {
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
            COUNT(*) AS total_visits,
            COUNT(CASE WHEN event_type = 'pageview' OR event_type IS NULL THEN 1 END) AS pageviews,
            COUNT(CASE WHEN event_type = 'lead' THEN 1 END) AS leads,
            COUNT(DISTINCT COALESCE(session_id, visitor_id)) AS sessions
          FROM visits
          WHERE project_id = ?
          GROUP BY visitor_id, ip_address
          ORDER BY last_visit DESC
          LIMIT ?
        `).bind(projectId, limit).all();

        return json(result.results);
      }

      if (cleanPath === "/" || cleanPath === "/admin" || cleanPath === "/admin.html") {
        return env.ASSETS.fetch(new Request(new URL("/admin.html", request.url)));
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Visitor Tracker Error:", error);
      return json({ error: "Internal server error" }, 500);
    }
  }
};
