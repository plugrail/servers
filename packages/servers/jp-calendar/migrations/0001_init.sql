-- 1B-1: 祝日CSV取込パイプラインのスキーマ。
--
-- holidays:     内閣府CSVの正規化済み内容そのもの（唯一の真実源はCSV — 計算による
--               祝日生成はしない。date は ISO "YYYY-MM-DD" に正規化して格納する）。
-- ingest_runs:  パイプライン実行履歴。死活監視、および 1B-2 の `data_as_of`
--               （= このテーブルの最新 status="ok" 行の ts）の取得元になる。

CREATE TABLE holidays (
  date TEXT PRIMARY KEY,  -- "2026-01-01"
  name TEXT NOT NULL
);

CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,               -- ISO8601（実行時刻）
  source TEXT NOT NULL,           -- "cao_syukujitsu_csv"
  status TEXT NOT NULL,           -- "ok" | "no_change" | "failed"
  source_hash TEXT,               -- 取得CSV(生バイト列)のsha256（変化検知・監査用）
  rows_added INTEGER,
  rows_removed INTEGER,
  rows_changed INTEGER,
  error TEXT
);

-- data_as_of / 死活監視は「最新の実行」を頻繁に引くので、ts の降順検索を支える。
CREATE INDEX idx_ingest_runs_ts ON ingest_runs (ts DESC);
CREATE INDEX idx_ingest_runs_status_ts ON ingest_runs (status, ts DESC);
