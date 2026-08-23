# PaperVN Status

PaperVN Status 是 PaperVN 系列服务的公开状态数据仓库。PaperVN App 会从本仓库读取 `status.json`，在 Today 页面顶部提示当前或计划中的服务异常，并提供完整的系统状态详情页。`src/index.ts` 是配套的 Cloudflare Worker：它会定时检查 PaperVN Connect 和 PaperVN反馈，并把结果提交回本仓库。

## 服务

状态文件包含以下服务：

- PaperVN Today
- PaperVN活动
- PaperVN Connect
- PaperVN反馈

每个服务的 `status` 可以是 `available`（可用）、`issue`（问题）或 `outage`（中断）。`impact` 可以是 `none`（无影响）、`partial`（部分用户受到影响）或 `all`（所有用户受到影响）。当服务可用时，App 不会在 Today 页面显示状态提示。

## 自动检测

Worker 使用 `* * * * *` 定时任务（每分钟一次）访问：

- `https://papervn.jizpaper.com/connect`
- `https://papervn.jizpaper.com/feedback/`

只有最终 HTTP 状态为 `2xx` 或 `3xx` 才算可访问。检测失败时，Connect 或反馈会变为“中断”、影响范围为“所有用户受到影响”，开始时间取第一次失败的时间，`endAt: null` 在 App 中显示为“现在”。恢复后会自动变为“可用”。Connect 的当前中断会派生为 PaperVN Today 和 PaperVN活动 的“问题”，影响范围为“部分用户受到影响”，并使用默认描述。

部署前创建 KV：

```sh
npm install
npx wrangler kv namespace create STATUS_KV
```

将返回的 namespace ID 填入 `wrangler.toml`，然后设置密钥并部署：

```sh
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

`GITHUB_TOKEN` 需要对 `JiZPaper/PaperVN-Status` 的 `status.json` 具有 Contents 写权限。Worker 会保留最近一次自动探测结果和手动覆盖，只有状态内容改变时才创建提交。

## 手动覆盖

自动检测仍然运行时，可用管理员 Bearer Token 逐项覆盖字段：

```sh
curl -X PUT 'https://<worker-domain>/admin/services/paperVNConnect' \
  -H 'Authorization: Bearer <ADMIN_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{"status":"issue","impact":"partial","description":"正在调查连接稳定性问题。"}'
```

支持 `status`、`impact`、`description`、`startAt`、`endAt`、`timePrecision`。把字段设为 `null` 会恢复该字段的自动值；`startAt` 填未来时间并设置 `status: "outage"` 即为计划中断。`DELETE /admin/services/<id>` 会清除该服务的全部覆盖。`POST /admin/check` 可以立即触发一次检测。

Worker 正常运行时不需要手动编辑 `status.json`；它会在状态变化时自动提交到 `main` 分支。App 获取的是 GitHub Raw 文件，发布提交后通常会在缓存周期结束后刷新。Worker 尚未部署或需要紧急修复时，也可以直接编辑并推送该文件。

### 字段说明

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-20T00:00:00+08:00",
  "services": [
    {
      "id": "paperVNConnect",
      "name": {
        "default": "PaperVN Connect",
        "zh-Hans": "PaperVN Connect",
        "zh-Hant": "PaperVN Connect",
        "en": "PaperVN Connect",
        "ja": "PaperVN Connect",
        "ko": "PaperVN Connect"
      },
      "status": "issue",
      "impact": "partial",
      "description": {
        "default": "Some users may be unable to sync account information.",
        "zh-Hans": "部分用户可能无法同步账户信息。",
        "zh-Hant": "部分使用者可能無法同步帳戶資訊。",
        "en": "Some users may be unable to sync account information.",
        "ja": "一部のユーザーがアカウント情報を同期できない可能性があります。",
        "ko": "일부 사용자가 계정 정보를 동기화하지 못할 수 있습니다."
      },
      "startAt": "2026-08-20T11:40:00+08:00",
      "endAt": null,
      "timePrecision": "datetime"
    }
  ]
}
```

- `id` 必须是 `paperVNToday`、`paperVNActivity`、`paperVNConnect` 或 `paperVNFeedback`。
- `name` 和 `description` 可以直接填写字符串，也可以填写本地化对象。对象使用 `default` 作为回退文本，语言键使用 BCP-47 标识。
- `startAt` 和 `endAt` 使用 ISO 8601。`endAt` 为 `null` 表示持续到现在。
- `timePrecision` 为 `datetime` 时填写具体时间，例如 `2026-08-20T11:40:00+08:00`；为 `date` 时填写日期，例如 `2026-08-22`。日期格式会显示为日期范围，具体时间会显示为带时分的范围。
- 未来的 `startAt` 会被视为计划事件；过去 `endAt` 的事件不会继续显示为异常。
- `updatedAt` 记录状态文件最近一次更新的时间，使用 ISO 8601。

更新状态后，应同时更新每个受影响服务的描述、影响范围和时间字段。问题结束后，将服务改回 `available`，并清空描述和时间字段。
