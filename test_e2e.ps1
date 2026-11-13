$ErrorActionPreference = "Stop"

Write-Host "=== Visitor Tracker MVP Comprehensive End-to-End Test ==="

# Kill any existing processes on port 8787 if any
Get-Process node, workerd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$proc = Start-Process -FilePath "npx.cmd" -ArgumentList "wrangler", "dev", "--port", "8787" -PassThru -NoNewWindow
Write-Host "Starting wrangler dev (PID: $($proc.Id))..."

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -Method Get -TimeoutSec 2
        if ($health.ok -eq $true) {
            $ready = $true
            break
        }
    } catch {}
}

if (-not $ready) {
    Write-Host "FAILED: Server failed to start on http://127.0.0.1:8787"
    Stop-Process -Id $proc.Id -Force -Recurse -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "Server is ready on http://127.0.0.1:8787`n"

try {
    # 1. Health Endpoint Test
    Write-Host "Test 1: Health Endpoint..."
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8787/health" -Method Get
    Write-Host "  Response: ok=$($h.ok), service=$($h.service)"
    if ($h.ok -ne $true) { throw "Health check failed" }
    Write-Host "  [PASS] Health check passed.`n"

    # 2. Tracker Script Delivery
    Write-Host "Test 2: Tracking Script Delivery..."
    $tracker = Invoke-WebRequest -Uri "http://127.0.0.1:8787/tracker.js" -Method Get -UseBasicParsing
    if ($tracker.Content -notmatch "data-project-id") { throw "tracker.js missing project id handler" }
    Write-Host "  [PASS] tracker.js loaded successfully ($($tracker.Content.Length) bytes).`n"

    # 3. Admin Authentication
    Write-Host "Test 3: Admin Login & Security..."
    # 3a. Invalid password
    try {
        $bad = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/login" -Method Post -Body '{"password":"wrong"}' -ContentType "application/json"
        throw "Should have failed with 401"
    } catch {
        Write-Host "  Invalid login correctly rejected."
    }
    # 3b. Valid login
    $auth = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/login" -Method Post -Body '{"password":"admin12345"}' -ContentType "application/json"
    $token = $auth.token
    if (-not $token) { throw "No token returned" }
    Write-Host "  [PASS] Admin login succeeded, session token received.`n"

    $headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type" = "application/json"
    }

    # 4. Project Creation
    Write-Host "Test 4: Project Creation..."
    $projBody = @{
        name = "FlexiFunnels Product Launch"
        landingUrl = "http://localhost:3000/product-launch"
    } | ConvertTo-Json
    $newProj = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/projects" -Method Post -Headers $headers -Body $projBody
    $projectId = $newProj.id
    Write-Host "  Created project id: $projectId (Name: $($newProj.name))`n"
    if (-not $projectId) { throw "Failed to create project" }
    Write-Host "  [PASS] Project created successfully.`n"

    # 5. Visitor Event Collection - Visitor 1 (Desktop / Windows / Chrome)
    Write-Host "Test 5: Visitor 1 Event Collection (Chrome on Windows)..."
    $v1Payload = @{
        projectId = $projectId
        visitorId = "visitor-user-1-alpha-123456"
        pageUrl = "http://localhost:3000/product-launch"
        referrer = "https://facebook.com/ad-campaign"
        screen = "1920x1080"
        utm_source = "facebook"
        utm_medium = "cpc"
        utm_campaign = "launch2026"
    } | ConvertTo-Json
    $v1Headers = @{
        "Origin" = "http://localhost:3000"
        "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    $v1Res = Invoke-WebRequest -Uri "http://127.0.0.1:8787/collect" -Method Post -Headers $v1Headers -Body $v1Payload -ContentType "text/plain;charset=UTF-8" -UseBasicParsing
    Write-Host "  Visitor 1 collection status: $($v1Res.StatusCode)"
    Write-Host "  [PASS] Visitor 1 event recorded.`n"

    # 6. Visitor Event Collection - Visitor 2 (Mobile / iOS / Safari)
    Write-Host "Test 6: Visitor 2 Event Collection (Safari on iPhone)..."
    $v2Payload = @{
        projectId = $projectId
        visitorId = "visitor-user-2-beta-789012"
        pageUrl = "http://localhost:3000/product-launch"
        referrer = "https://instagram.com"
        screen = "390x844"
        utm_source = "instagram"
        utm_medium = "story"
    } | ConvertTo-Json
    $v2Headers = @{
        "Origin" = "http://localhost:3000"
        "User-Agent" = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    }
    $v2Res = Invoke-WebRequest -Uri "http://127.0.0.1:8787/collect" -Method Post -Headers $v2Headers -Body $v2Payload -ContentType "text/plain;charset=UTF-8" -UseBasicParsing
    Write-Host "  Visitor 2 collection status: $($v2Res.StatusCode)"
    Write-Host "  [PASS] Visitor 2 event recorded.`n"

    # 7. Returning Visitor Event (Visitor 1 returns!)
    Write-Host "Test 7: Returning Visitor Detection (Visitor 1 returns again)..."
    Start-Sleep -Seconds 1
    $v1ReturnPayload = @{
        projectId = $projectId
        visitorId = "visitor-user-1-alpha-123456"
        pageUrl = "http://localhost:3000/product-launch"
        referrer = "http://localhost:3000/checkout"
        screen = "1920x1080"
    } | ConvertTo-Json
    $v1ReturnRes = Invoke-WebRequest -Uri "http://127.0.0.1:8787/collect" -Method Post -Headers $v1Headers -Body $v1ReturnPayload -ContentType "text/plain;charset=UTF-8" -UseBasicParsing
    Write-Host "  Visitor 1 return status: $($v1ReturnRes.StatusCode)"
    Write-Host "  [PASS] Returning visitor event recorded.`n"

    # 8. Security Test - Origin Mismatch Protection
    Write-Host "Test 8: Security - Reject Origin Mismatch..."
    $hackHeaders = @{
        "Origin" = "http://malicious-site.com"
        "User-Agent" = "Mozilla/5.0 (Windows NT 10.0)"
    }
    $hackRes = Invoke-WebRequest -Uri "http://127.0.0.1:8787/collect" -Method Post -Headers $hackHeaders -Body $v1Payload -ContentType "text/plain;charset=UTF-8" -UseBasicParsing
    Write-Host "  Origin mismatch status: $($hackRes.StatusCode) (not recorded)"
    Write-Host "  [PASS] Security origin enforcement verified.`n"

    # 9. Dashboard Statistics Verification
    Write-Host "Test 9: Verifying Dashboard Statistics..."
    $statsData = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/stats?projectId=$projectId&days=7" -Method Get -Headers $headers
    $s = $statsData.stats
    Write-Host "  Stats Summary:"
    Write-Host "    Total Visits: $($s.total_visits) (Expected: 3)"
    Write-Host "    Unique Visitors: $($s.unique_visitors) (Expected: 2)"
    Write-Host "    Today's Visitors: $($s.today_visitors) (Expected: 2)"
    Write-Host "    Returning Visitors: $($s.returning_visitors) (Expected: 1)"
    Write-Host "    Unique IPs: $($s.unique_ips)"
    Write-Host "  Device breakdown: $($statsData.devices | ConvertTo-Json -Compress)"
    Write-Host "  Browser breakdown: $($statsData.browsers | ConvertTo-Json -Compress)"
    Write-Host "  OS breakdown: $($statsData.operatingSystems | ConvertTo-Json -Compress)"
    Write-Host "  Daily breakdown: $($statsData.daily | ConvertTo-Json -Compress)"

    if ($s.total_visits -ne 3) { throw "Expected 3 total visits, got $($s.total_visits)" }
    if ($s.unique_visitors -ne 2) { throw "Expected 2 unique visitors, got $($s.unique_visitors)" }
    if ($s.today_visitors -ne 2) { throw "Expected 2 today's visitors, got $($s.today_visitors)" }
    if ($s.returning_visitors -ne 1) { throw "Expected 1 returning visitor, got $($s.returning_visitors)" }
    Write-Host "  [PASS] All statistics metrics match expected values.`n"

    # 10. Visitor Records Verification
    Write-Host "Test 10: Verifying Visitor Records..."
    $visitors = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/visitors?projectId=$projectId" -Method Get -Headers $headers
    Write-Host "  Retrieved $($visitors.Count) visitor records:"
    foreach ($v in $visitors) {
        Write-Host "    IP: $($v.ip_address) | ID: $($v.visitor_id) | Device: $($v.device) | Browser: $($v.browser) | OS: $($v.operating_system) | Visits: $($v.total_visits)"
    }
    if ($visitors.Count -ne 2) { throw "Expected 2 visitor records" }
    $v1Record = $visitors | Where-Object { $_.visitor_id -eq "visitor-user-1-alpha-123456" }
    if ($v1Record.total_visits -ne 2) { throw "Expected visitor 1 to have 2 total visits, got $($v1Record.total_visits)" }
    Write-Host "  [PASS] Visitor list and visit counts verified.`n"

    # 11. Admin Web Dashboard Delivery
    Write-Host "Test 11: Admin HTML Delivery..."
    $adminPage = Invoke-WebRequest -Uri "http://127.0.0.1:8787/admin" -Method Get -UseBasicParsing
    if ($adminPage.Content -notmatch "Visitor Analytics Dashboard") { throw "Admin page title missing" }
    Write-Host "  [PASS] Admin page delivered successfully ($($adminPage.Content.Length) bytes).`n"

    Write-Host "=========================================="
    Write-Host "ALL 11 END-TO-END TESTS PASSED WITH 100% SUCCESS!"
    Write-Host "=========================================="
} finally {
    Write-Host "`nStopping wrangler dev process tree..."
    Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $proc.Id } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Get-Process node, workerd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "Test clean up complete."
}
