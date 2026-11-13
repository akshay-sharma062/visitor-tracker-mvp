PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  landing_url TEXT NOT NULL,
  allowed_origin TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  session_id TEXT,
  event_type TEXT NOT NULL DEFAULT 'pageview',
  event_id TEXT,
  ip_address TEXT,
  device TEXT,
  browser TEXT,
  operating_system TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  page_url TEXT,
  referrer TEXT,
  screen_resolution TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  visited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_visits_project_date
  ON visits(project_id, visited_at);
CREATE INDEX IF NOT EXISTS idx_visits_project_ip
  ON visits(project_id, ip_address);
CREATE INDEX IF NOT EXISTS idx_visits_project_visitor
  ON visits(project_id, visitor_id);
CREATE INDEX IF NOT EXISTS idx_visits_project_session
  ON visits(project_id, session_id);
CREATE INDEX IF NOT EXISTS idx_visits_project_type
  ON visits(project_id, event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_project_event
  ON visits(project_id, event_id) WHERE event_id IS NOT NULL;
