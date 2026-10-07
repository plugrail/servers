# Privacy Policy — PlugRail JP Corporate

Last updated: 2026-10-07

## 1. What data this service handles

This service returns **corporate registry information** derived from public data published by Japan's National Tax Agency (NTA):

- Corporate number (13 digits), trade name / company name, registered address, prefecture code, status.
- Name kana (`name_kana`): the officially published reading of the **company name** (a corporate attribute, not a personal name).
- Invoice issuer number status (registered / cancelled / expired with dates).

## 2. How personal-name fields are treated

- **Company-name kana is not personal data.** `name_kana` is the reading of the company name (法人名称) as published on the NTA corporate number publication site. It is handled as corporate information.
- **Representative / officer names are not collected, stored, or returned.** No tool in this service outputs personal names.
- **`verify_invoice_number` carries no personal identifiers by design**: the implementation returns neither personal names, trade names, nor addresses (see source comment "氏名・名称・所在地は運ばない"), and never touches sole-proprietor records (source comment "個人事業主データ (`k_*`) には一切触れない").
- **Sole proprietors are unpublished by default.** The invoice publication site excludes sole proprietors unless published; a "not found" result therefore means "not published or not yet recorded" and is never treated as proof of invalidity or non-existence.
- **No personal data is required from users.** The free tier works without any key; Pro users provide an API key and the billing identity handled by Stripe.

## 3. What we log

- API request metadata (timestamp, tool name, status, product id) for usage metering, rate limiting, and billing.
- API keys are stored as hashes, never in plain text.
- For the free tier without a key, the monthly call count is kept per IP address as a salted hash; the raw IP address is not stored.

## 4. Data sharing

- We do not sell user data. Request metadata is processed on Cloudflare infrastructure (Workers / D1 / KV) and by Stripe for payment processing.
- Corporate search results are derived from NTA public data; source notices are in [README.md](README.md).

## 5. Retention and deletion

- Usage/billing records: retained while the subscription is active and for 7 years after contract end, in line with tax and bookkeeping statutory retention.
- API keys: revoked on request via support contact support@plugrail.dev.

## 6. Contact

support@plugrail.dev

---

# プライバシーポリシー — PlugRail JP Corporate

最終更新: 2026-10-07

## 1. 扱うデータ

本サービスが返すのは国税庁の公開データを基にした**法人情報**です。

- 法人番号 (13桁)、商号・名称、所在地、都道府県コード、状態。
- 法人名フリガナ (`name_kana`): 公表されている**法人名称の読み**であり、個人名ではありません。
- インボイス発行事業者の登録状態 (登録・取消・失効と日付)。

## 2. 個人名フィールドの扱い

- **法人名フリガナは個人情報として扱いません。** 国税庁法人番号公表サイトで公表されている法人属性です。
- **代表者名・役員名は収集・保存・返却しません。** いずれのツールも個人名を出力しません。
- **`verify_invoice_number` は設計上個人識別子を運びません**: 氏名・名称・所在地を返さず (実装コメント「氏名・名称・所在地は運ばない」)、個人事業主レコード (`k_*`) には一切触れません (実装コメント「個人事業主データ (`k_*`) には一切触れない」)。
- **個人事業者は既定で非掲載です。** 公表サイトの収録対象外のため、「見つからない」は「個人非掲載または未収録」を意味し、無効・不存在の断定には使いません。
- **利用者から個人情報の提供は求めません。** 無料枠はキー不要です。Pro 利用者のみ API キーと Stripe 上の課金情報を扱います。

## 3. ログ

- 利用量計測・レート制限・課金のため、リクエストのメタデータ (時刻・ツール名・成否・product id) を記録します。
- API キーはハッシュで保存し、平文では保存しません。
- キーなしの無料枠は、月間回数を IP アドレスの salt 付きハッシュ単位で数えます。IP アドレスそのものは保存しません。

## 4. 第三者提供

- 利用者データを販売しません。メタデータは Cloudflare 基盤 (Workers / D1 / KV) と決済のための Stripe でのみ処理します。
- 法人検索結果は国税庁公開データ由来です。出典表示は [README.md](README.md) 参照。

## 5. 保存期間・削除

- 利用・課金記録: 契約中有効＋契約終了後7年（税務・会計の法定保存に合わせる）。
- API キー: サポート連絡先 support@plugrail.dev への申請で失効します。

## 6. 連絡先

support@plugrail.dev
```
