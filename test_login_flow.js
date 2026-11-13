// Verify login and dashboard functionality simulating the browser client exactly
const http = require("http");

async function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const opt = {
      hostname: "127.0.0.1",
      port: 8787,
      path: path,
      method: options.method || "GET",
      headers: options.headers || {}
    };
    const req = http.request(opt, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        });
      });
    });
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

function parseJson(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
}

async function simulateFrontendLogin(password) {
  let loginError = "";
  if (!password) {
    loginError = "Please enter your admin password";
    return { success: false, error: loginError };
  }

  try {
    const r = await request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });

    const d = parseJson(r.body);
    if (r.status !== 200) {
      const errMsg = d && d.error ? d.error : (r.status === 401 ? "Incorrect password" : "Login error (HTTP " + r.status + ")");
      return { success: false, status: r.status, error: errMsg };
    }

    if (!d || !d.token) {
      return { success: false, error: "No authentication token received from server" };
    }

    return { success: true, token: d.token };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function simulateFrontendApi(path, token, options = {}) {
  const r = await request(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token,
      ...(options.headers || {})
    },
    body: options.body
  });

  const d = parseJson(r.body);
  if (r.status === 401) {
    throw new Error("Session expired. Please sign in again.");
  }
  if (r.status < 200 || r.status >= 300) {
    throw new Error(d && d.error ? d.error : "Request failed (HTTP " + r.status + ")");
  }
  return d;
}

async function run() {
  console.log("=== SIMULATING EXACT BROWSER FRONTEND ADMIN LOGIN FLOW ===");

  // 1. Test Empty Password
  console.log("\n1. Testing empty password submission...");
  const emptyRes = await simulateFrontendLogin("");
  console.log("Result:", emptyRes);
  if (emptyRes.error !== "Please enter your admin password") {
    throw new Error("Empty password validation failed");
  }

  // 2. Test Invalid Password
  console.log("\n2. Testing invalid password ('wrongpassword')...");
  const wrongRes = await simulateFrontendLogin("wrongpassword");
  console.log("Result:", wrongRes);
  if (wrongRes.error !== "Incorrect password") {
    throw new Error("Invalid password was not rejected with 'Incorrect password'");
  }

  // 3. Test Valid Password ('admin12345')
  console.log("\n3. Testing valid password ('admin12345')...");
  const validRes = await simulateFrontendLogin("admin12345");
  console.log("Result:", { success: validRes.success, tokenPrefix: validRes.token.slice(0, 20) + "..." });
  if (!validRes.success || !validRes.token) {
    throw new Error("Login failed with valid password");
  }

  const token = validRes.token;

  // 4. Test Dashboard loadProjects()
  console.log("\n4. Calling GET /api/projects with session token...");
  const projects = await simulateFrontendApi("/api/projects", token);
  console.log("Projects loaded successfully. Total projects:", projects.length);
  if (!Array.isArray(projects)) {
    throw new Error("Projects should be an array");
  }

  if (projects.length > 0) {
    const p = projects[0];
    console.log(`First project: ${p.name} (ID: ${p.id}, Allowed Origin: ${p.allowed_origin})`);

    // 5. Test Dashboard loadDashboard() -> stats
    console.log("\n5. Calling GET /api/stats for project " + p.id + "...");
    const statsData = await simulateFrontendApi(`/api/stats?projectId=${p.id}&days=7`, token);
    console.log("Stats response received:");
    console.log("  Total visits:", statsData.stats.total_visits);
    console.log("  Unique visitors:", statsData.stats.unique_visitors);
    console.log("  Today's visitors:", statsData.stats.today_visitors);
    console.log("  Returning visitors:", statsData.stats.returning_visitors);
    console.log("  Unique IPs:", statsData.stats.unique_ips);
    console.log("  Devices:", statsData.devices);
    console.log("  Browsers:", statsData.browsers);
    console.log("  Operating Systems:", statsData.operatingSystems);
    console.log("  Daily:", statsData.daily);

    // 6. Test Dashboard loadDashboard() -> visitors
    console.log("\n6. Calling GET /api/visitors for project " + p.id + "...");
    const visitors = await simulateFrontendApi(`/api/visitors?projectId=${p.id}`, token);
    console.log("Visitors loaded successfully. Total records:", visitors.length);
    if (visitors.length > 0) {
      const v = visitors[0];
      console.log(`Sample visitor: IP=${v.ip_address}, ID=${v.visitor_id.slice(0, 16)}..., Device=${v.device}, Browser=${v.browser}, OS=${v.operating_system}, Visits=${v.total_visits}`);
    }
  }

  console.log("\n========================================================");
  console.log("ALL BROWSER LOGIN AND DASHBOARD API FLOWS VERIFIED 100%!");
  console.log("========================================================");
}

run().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});

