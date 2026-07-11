import { describe, expect, it } from "vitest";
import {
  DISCLAIMER_TEXT,
  DISCLAIMER_URL,
  err,
  formatText,
  ok,
  type SourceKey,
  toWireEnvelope,
} from "./envelope.js";
import { SOURCES } from "./sources.js";

describe("ok() builder", () => {
  it("resolves source keys into full Source entries", () => {
    const result = ok(
      { hello: "world" },
      { sources: ["cabinet_office_holidays"], fetched_at: "2026-07-10T02:00:00Z" },
      "要約",
    );
    expect(result.meta.sources).toEqual([SOURCES.cabinet_office_holidays]);
  });

  it("auto-injects the disclaimer (caller cannot pass it)", () => {
    const result = ok(
      { x: 1 },
      { sources: ["cabinet_office_holidays"], fetched_at: "2026-07-10T02:00:00Z" },
      "要約",
    );
    expect(result.meta.disclaimer).toBe(DISCLAIMER_TEXT);
    expect(result.meta.disclaimer).toContain(DISCLAIMER_URL);
  });

  it("passes through optional data_as_of / cache / masking only when set", () => {
    const bare = ok({ x: 1 }, { sources: ["cabinet_office_holidays"], fetched_at: "t" }, "s");
    expect(bare.meta).not.toHaveProperty("data_as_of");
    expect(bare.meta).not.toHaveProperty("cache");

    const rich = ok(
      { x: 1 },
      {
        sources: ["cabinet_office_holidays"],
        fetched_at: "t",
        data_as_of: "2026-04-01",
        cache: "hit",
      },
      "s",
    );
    expect(rich.meta.data_as_of).toBe("2026-04-01");
    expect(rich.meta.cache).toBe("hit");
  });

  it("matches the design §8-1 success sample shape on the wire", () => {
    const result = ok(
      { date: "2026-01-01", is_holiday: true, name: "元日" },
      {
        sources: ["cabinet_office_holidays"],
        fetched_at: "2026-07-10T02:00:00Z",
        data_as_of: "2026-04-01",
        cache: "hit",
      },
      "2026-01-01 は祝日です（元日）。",
    );
    // structuredContent must NOT carry the `summary` field (§7).
    const wire = toWireEnvelope(result);
    expect(wire).toEqual({
      ok: true,
      data: { date: "2026-01-01", is_holiday: true, name: "元日" },
      meta: {
        sources: [
          {
            name: "内閣府「国民の祝日について」",
            url: "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html",
            license: "公共データ利用規約(第1.0版)",
          },
        ],
        fetched_at: "2026-07-10T02:00:00Z",
        data_as_of: "2026-04-01",
        cache: "hit",
        disclaimer: DISCLAIMER_TEXT,
      },
    });
    expect(wire).not.toHaveProperty("summary");
  });
});

describe("err() builder", () => {
  it("injects the disclaimer and keeps hint optional", () => {
    const noHint = err({ code: "internal", message: "boom" });
    expect(noHint.meta.disclaimer).toBe(DISCLAIMER_TEXT);
    expect(noHint.error).not.toHaveProperty("hint");

    const withHint = err({
      code: "out_of_data_range",
      message: "範囲外",
      hint: "再実行してください",
    });
    expect(withHint.error.hint).toBe("再実行してください");
  });
});

describe("formatText() (content[0].text auto-generation, §7)", () => {
  it("appends citation line + disclaimer to the tool summary on success", () => {
    const result = ok(
      { date: "2026-01-01" },
      { sources: ["cabinet_office_holidays"], fetched_at: "2026-07-10T02:00:00Z" },
      "2026-01-01 は祝日です（元日）。",
    );
    const text = formatText(result);
    expect(text).toContain("2026-01-01 は祝日です（元日）。");
    expect(text).toContain(
      "出典: 内閣府「国民の祝日について」 https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html を加工して作成",
    );
    expect(text).toContain(DISCLAIMER_TEXT);
  });

  it("includes error message, hint and disclaimer on failure (§8-2)", () => {
    const result = err({
      code: "out_of_data_range",
      message: "指定された日付 2010-01-01 は本サービスが保持する祝日データの範囲外です。",
      hint: "本サービスが保持する祝日データの対応範囲は2020-01-01〜2027-12-31です。範囲内の日付で再実行してください。",
    });
    const text = formatText(result);
    expect(text.startsWith("エラー: 指定された日付 2010-01-01")).toBe(true);
    expect(text).toContain("範囲内の日付で再実行してください");
    expect(text).toContain(DISCLAIMER_TEXT);
  });
});

describe("type-level guarantees (compile-time, §10.7)", () => {
  it("rejects an empty sources array", () => {
    // @ts-expect-error — sources is a non-empty tuple; [] is a type error (§2).
    ok({ x: 1 }, { sources: [], fetched_at: "t" }, "s");
  });

  it("rejects a raw {name,url} literal (sources are key references only, §10.4)", () => {
    // @ts-expect-error — only SourceKey values are accepted, never Source literals.
    ok({ x: 1 }, { sources: [{ name: "x", url: "y" }], fetched_at: "t" }, "s");
  });

  it("does not let the caller pass a disclaimer (§10.2)", () => {
    // @ts-expect-error — disclaimer is auto-injected; it is not part of OkMetaInput.
    ok({ x: 1 }, { sources: ["cabinet_office_holidays"], fetched_at: "t", disclaimer: "偽" }, "s");
  });

  it("rejects an unknown source key", () => {
    // @ts-expect-error — "nope" is not a SourceKey.
    ok({ x: 1 }, { sources: ["nope"], fetched_at: "t" }, "s");
  });

  it("only accepts declared SourceKeys", () => {
    const keys: SourceKey[] = ["cabinet_office_holidays", "nta_houjin_bangou", "nta_invoice_kohyo"];
    expect(keys).toHaveLength(3);
  });
});
