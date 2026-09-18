# PaperVN Status

PaperVN Status 是 PaperVN 系列服务的公开状态数据仓库。PaperVN App 会从本仓库读取 `status.json`，在 Today 页面顶部提示当前或计划中的服务异常，并提供完整的系统状态详情页。状态由维护者手动更新，仓库本身不执行后台任务。

## 服务

状态文件包含以下服务：

- PaperVN Today
- PaperVN活动（PaperVN Event）
- PaperVN Connect
- PaperVN反馈

每个服务的 `status` 可以是 `available`（可用）、`issue`（问题）或 `outage`（中断）。`impact` 可以是 `none`（无影响）、`partial`（部分用户受到影响）或 `all`（所有用户受到影响）。当服务可用时，App 不会在 Today 页面显示状态提示。

## 更新状态

直接编辑根目录的 `status.json`，提交并推送到 `main` 分支即可。每次更新时修改 `updatedAt`，并同步填写受影响服务的状态、影响范围、描述和时间字段。App 获取的是 GitHub Raw 文件，发布提交后通常会在缓存周期结束后刷新。

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
        "default": "",
        "zh-Hans": "",
        "zh-Hant": "",
        "en": "",
        "ja": "",
        "ko": ""
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
