import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import edgeCaseTableJson from "./fixtures/edge-case-table.json";
import {
  SNAPSHOT_DATA_AS_OF,
  SNAPSHOT_DATA_RANGE,
  seedFullSnapshot,
} from "./setup/seed-holidays.js";

// 1B-4: 祝日制度の特異ケース（振替休日・国民の休日・2019年の一回限りの祝日・東京五輪
// 特措法による移動）のデータ駆動テスト。1B-4.md「設計原則」どおり、振替休日等の
// ルールはここで再実装せず、test/fixtures/edge-case-table.json（内閣府の実CSV
// スナップショットに直接 grep 突合して確認した事実のみを収録）を is_holiday /
// add_business_days / business_days_between に通して検証する。
//
// 1B-2/1B-3のツールテスト（../tools/holidays.test.ts 等）は93行の手動キュレート
// fixture（validBase）で十分だったが、1B-4は「取込の正しさ」自体も検証対象
// （1B-4.md 設計原則1）のため、../setup/seed-holidays.ts の `seedFullSnapshot()`
// で実際の内閣府CSV全量スナップショット（./fixtures/
// syukujitsu-snapshot-2026-07-10.csv, ~1067行）を実際の runIngest() パイプライン
// に通して使う。CIのネットワーク不可でも自己完結するよう、このスナップショットは
// リポジトリに実バイト（Shift_JIS）で checked in されている
// （./fixtures/snapshot.ts が復元し、vitest.config.ts が Node側で読んでbase64
// バインディングとして注入する仕組み — fsがworkerdランタイム内で使えないため）。
//
// 呼び出しスタイル・レート制限回避（pro plan key）は ../tools/holidays.test.ts /
// ../tools/business-days.test.ts と同じ（このファイルも多数の/mcp呼び出しを行う
// ため、匿名10req/minの制限に当たらないようにする）。

interface EdgeCase {
  date: string;
  expect_holiday: boolean;
  name_contains?: string;
  category: string;
  source: string;
  note?: string;
}

const edgeCaseTable = edgeCaseTableJson as { cases: EdgeCase[] };

const MCP_URL = "https://example.com/mcp";
const PROTOCOL_VERSION = "2025-06-18";

function requestHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
  };
}

async function readMessage(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("text/event-stream")) {
    const dataLines = text
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice("data:".length).trim());
    return JSON.parse(dataLines[dataLines.length - 1] ?? "null");
  }
  return text ? JSON.parse(text) : null;
}

interface CallToolMessage {
  result?: {
    content: Array<{ type: string; text: string }>;
    structuredContent?: {
      ok: boolean;
      data?: unknown;
      error?: { code: string; message: string; hint?: string };
      meta: {
        sources?: Array<{ name: string; url: string }>;
        disclaimer: string;
        data_as_of?: string;
      };
    };
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

let nextId = 5000;

async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolMessage> {
  const res = await SELF.fetch(MCP_URL, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return (await readMessage(res)) as CallToolMessage;
}

interface IsHolidayData {
  date: string;
  is_holiday: boolean;
  holiday_name: string | null;
  weekday: string;
  is_weekend: boolean;
}

interface AddResultData {
  result: string;
  input_date: string;
  days: number;
  calendar: string;
  skipped: Array<{ date: string; reason: string }>;
  skipped_total: number;
}

beforeAll(async () => {
  await seedFullSnapshot();
});

describe("事実表の健全性", () => {
  it("最低15ケース、必須カテゴリの最低件数を満たす", () => {
    expect(edgeCaseTable.cases.length).toBeGreaterThanOrEqual(15);

    const byCategory = new Map<string, number>();
    for (const c of edgeCaseTable.cases) {
      byCategory.set(c.category, (byCategory.get(c.category) ?? 0) + 1);
    }
    const furikae = byCategory.get("furikae") ?? 0;
    const nationalHoliday = byCategory.get("national-holiday") ?? 0;
    const oneOff2019 = byCategory.get("one-off-2019") ?? 0;
    const olympicsMoved = byCategory.get("olympics-moved") ?? 0;
    const negatives = edgeCaseTable.cases.filter((c) => c.expect_holiday === false).length;

    expect(furikae).toBeGreaterThanOrEqual(3);
    expect(nationalHoliday).toBeGreaterThanOrEqual(2);
    expect(oneOff2019).toBeGreaterThanOrEqual(4);
    expect(olympicsMoved).toBeGreaterThanOrEqual(4);
    expect(negatives).toBeGreaterThanOrEqual(2);
  });
});

describe("事実表データ駆動テスト — is_holiday", () => {
  it.each(
    edgeCaseTable.cases.map((c): [string, EdgeCase] => [`${c.date} (${c.category})`, c]),
  )("%s", async (_label, testCase) => {
    const msg = await callTool("is_holiday", { date: testCase.date });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as IsHolidayData;

    expect(data.is_holiday).toBe(testCase.expect_holiday);
    if (testCase.expect_holiday) {
      expect(data.holiday_name).not.toBeNull();
      if (testCase.name_contains !== undefined) {
        expect(data.holiday_name).toContain(testCase.name_contains);
      }
    } else {
      expect(data.holiday_name).toBeNull();
    }
  });
});

describe("営業日計算との結合", () => {
  it("2019年GW（4/27〜5/6の10連休）: 4/26(金)の翌営業日は5/7(火)", async () => {
    const msg = await callTool("add_business_days", { date: "2019-04-26", days: 1 });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as AddResultData;
    expect(data.result).toBe("2019-05-07");
    // 10連休の全10日 (4/27-5/6) が飛ばされていることも確認する。
    expect(data.skipped.map((s) => s.date)).toEqual([
      "2019-04-27",
      "2019-04-28",
      "2019-04-29",
      "2019-04-30",
      "2019-05-01",
      "2019-05-02",
      "2019-05-03",
      "2019-05-04",
      "2019-05-05",
      "2019-05-06",
    ]);
  });

  it("2021-10-11（スポーツの日が無い年の月曜）は平日として扱われ、飛ばされない", async () => {
    // 2021-10-08(金) + 1営業日。もし2021-10-11が(旧来の日程どおり)祝日扱いされて
    // しまっていたら結果は2019-10-12になってしまうはずだが、実CSVでは2021年10月に
    // 祝日が1件も無いため、正しい結果は2021-10-11（土日だけを飛ばす）。
    const msg = await callTool("add_business_days", { date: "2021-10-08", days: 1 });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as AddResultData;
    expect(data.result).toBe("2021-10-11");
    expect(data.skipped).toEqual([
      { date: "2021-10-09", reason: "土曜日" },
      { date: "2021-10-10", reason: "日曜日" },
    ]);
  });

  it("business_days_between も2021-10-11を営業日として数える", async () => {
    const msg = await callTool("business_days_between", {
      from: "2021-10-07",
      to: "2021-10-12",
    });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as { business_days: number };
    // (from非含む, to含む) => 10/8(金),10/11(月),10/12(火) の3営業日
    // (10/9土, 10/10日は除外)。
    expect(data.business_days).toBe(3);
  });
});

describe("ガード: CSVデータ範囲外", () => {
  it(`is_holiday: CSV最新年+1年の日付 (${SNAPSHOT_DATA_RANGE.max}の翌年) => out_of_data_range`, async () => {
    const msg = await callTool("is_holiday", { date: "2028-06-15" });
    expect(msg.result?.isError).toBe(true);
    const error = msg.result?.structuredContent?.error;
    expect(error?.code).toBe("out_of_data_range");
    expect(error?.hint).toContain(SNAPSHOT_DATA_RANGE.min);
    expect(error?.hint).toContain(SNAPSHOT_DATA_RANGE.max);
  });

  it("add_business_days: CSV最新年+1年の日付 => out_of_data_range", async () => {
    const msg = await callTool("add_business_days", { date: "2028-06-15", days: 1 });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("out_of_data_range");
  });

  it("is_holiday: CSV収録範囲の下限 (1955-01-01) 前日は out_of_data_range", async () => {
    const msg = await callTool("is_holiday", { date: "1954-12-31" });
    expect(msg.result?.isError).toBe(true);
    expect(msg.result?.structuredContent?.error?.code).toBe("out_of_data_range");
  });
});

describe("実CSVスナップショットの取込確認", () => {
  it("data_as_of は実CSVスナップショットの取込実行時刻を反映する", async () => {
    const msg = await callTool("is_holiday", { date: "2026-01-01" });
    expect(msg.result?.structuredContent?.meta.data_as_of).toBe(SNAPSHOT_DATA_AS_OF);
  });

  it("list_holidays: 1955年は9件（実CSVのそのままの行数）", async () => {
    const msg = await callTool("list_holidays", { year: 1955 });
    expect(msg.result?.isError).toBeFalsy();
    const data = msg.result?.structuredContent?.data as { count: number };
    expect(data.count).toBe(9);
  });
});
