export type ServiceID =
  | "paperVNToday"
  | "paperVNActivity"
  | "paperVNConnect"
  | "paperVNFeedback";
export type ServiceStatus = "available" | "issue" | "outage";
export type Impact = "none" | "partial" | "all";
export type TimePrecision = "date" | "datetime";
export type LocalizedText = string | Record<string, string>;

export interface Service {
  id: ServiceID;
  name: LocalizedText;
  status: ServiceStatus;
  impact: Impact;
  description: LocalizedText | null;
  startAt: string | null;
  endAt: string | null;
  timePrecision: TimePrecision | null;
}

export interface StatusDocument {
  schemaVersion: 1;
  updatedAt: string;
  services: Service[];
}

export interface ServiceOverride {
  status?: ServiceStatus | null;
  impact?: Impact | null;
  description?: LocalizedText | null;
  startAt?: string | null;
  endAt?: string | null;
  timePrecision?: TimePrecision | null;
}

export type Overrides = Partial<Record<ServiceID, ServiceOverride>>;

export interface ProbeState {
  available: boolean;
  startAt: string | null;
}

export interface AutoState {
  updatedAt: string;
  probes: Record<"connect" | "feedback", ProbeState>;
}

export interface Env {
  STATUS_KV: KVNamespace;
  ADMIN_TOKEN: string;
  GITHUB_TOKEN: string;
  GITHUB_REPOSITORY: string;
  GITHUB_BRANCH: string;
  GITHUB_STATUS_PATH: string;
  STATUS_RAW_URL: string;
}

const DEFAULT_DESCRIPTION: LocalizedText = {
  "default": "中国大陆用户目前在使用此服务时可能遇到无法载入的问题。",
  "zh-Hans": "中国大陆用户目前在使用此服务时可能遇到无法载入的问题。",
  "zh-Hant": "中國大陸使用者目前使用此服務時可能會遇到無法載入的問題。",
  "en": "Users in mainland China may currently encounter loading issues when using this service.",
  "ja": "中国本土のユーザーは現在、このサービスの利用時に読み込めない問題が発生する可能性があります。",
  "ko": "중국 본토 사용자는 현재 이 서비스를 이용할 때 로드되지 않는 문제를 겪을 수 있습니다."
};

const NAMES: Record<ServiceID, LocalizedText> = {
  paperVNToday: "PaperVN Today",
  paperVNActivity: {
    "default": "PaperVN活动",
    "zh-Hans": "PaperVN活动",
    "zh-Hant": "PaperVN活動",
    "en": "PaperVN Events",
    "ja": "PaperVNイベント",
    "ko": "PaperVN 이벤트"
  },
  paperVNConnect: "PaperVN Connect",
  paperVNFeedback: {
    "default": "PaperVN反馈",
    "zh-Hans": "PaperVN反馈",
    "zh-Hant": "PaperVN反饋",
    "en": "PaperVN Feedback",
    "ja": "PaperVNフィードバック",
    "ko": "PaperVN 피드백"
  }
};

const PROBE_URLS = {
  connect: "https://papervn.jizpaper.com/connect",
  feedback: "https://papervn.jizpaper.com/feedback/"
} as const;

const SERVICE_IDS: ServiceID[] = [
  "paperVNToday",
  "paperVNActivity",
  "paperVNConnect",
  "paperVNFeedback"
];

function iso(date: Date): string {
  return date.toISOString();
}

function isValidServiceID(value: string): value is ServiceID {
  return SERVICE_IDS.includes(value as ServiceID);
}

function isValidOverride(value: unknown): value is ServiceOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const allowed = ["status", "impact", "description", "startAt", "endAt", "timePrecision"];
  if (Object.keys(body).some(key => !allowed.includes(key))) return false;
  if (body.status !== undefined && body.status !== null && !["available", "issue", "outage"].includes(String(body.status))) return false;
  if (body.impact !== undefined && body.impact !== null && !["none", "partial", "all"].includes(String(body.impact))) return false;
  if (body.timePrecision !== undefined && body.timePrecision !== null && !["date", "datetime"].includes(String(body.timePrecision))) return false;
  for (const key of ["startAt", "endAt"] as const) {
    const item = body[key];
    if (item !== undefined && item !== null && (typeof item !== "string" || Number.isNaN(Date.parse(item)))) return false;
  }
  const description = body.description;
  if (description !== undefined && description !== null && typeof description !== "string") {
    if (typeof description !== "object" || Array.isArray(description) || Object.values(description).some(item => typeof item !== "string")) return false;
  }
  return true;
}

function isActive(startAt: string | null, now: Date): boolean {
  if (!startAt) return true;
  const start = Date.parse(startAt);
  return Number.isNaN(start) || start <= now.getTime();
}

function hasActiveConnectOutage(service: Service, now: Date): boolean {
  return service.status === "outage" && isActive(service.startAt, now);
}

function overrideValue<T>(override: ServiceOverride | undefined, key: keyof ServiceOverride, fallback: T): T {
  const value = override?.[key];
  return value === undefined || value === null ? fallback : value as T;
}

function serviceWithOverride(
  id: ServiceID,
  base: Omit<Service, "id" | "name">,
  overrides: Overrides,
  now: Date
): Service {
  const override = overrides[id];
  const status = overrideValue(override, "status", base.status);
  const startAt = overrideValue(override, "startAt", base.startAt);
  const finalStartAt = status === "outage" && !startAt && override?.status === "outage"
    ? iso(now)
    : startAt;
  return {
    id,
    name: NAMES[id],
    status,
    impact: overrideValue(override, "impact", base.impact),
    description: overrideValue(override, "description", base.description),
    startAt: finalStartAt,
    endAt: overrideValue(override, "endAt", base.endAt),
    timePrecision: overrideValue(override, "timePrecision", base.timePrecision)
  };
}

export function buildDocument(
  now: Date,
  autoState: AutoState,
  overrides: Overrides
): StatusDocument {
  const connectDown = !autoState.probes.connect.available;
  const feedbackDown = !autoState.probes.feedback.available;
  const connectStart = connectDown ? autoState.probes.connect.startAt ?? iso(now) : null;
  const feedbackStart = feedbackDown ? autoState.probes.feedback.startAt ?? iso(now) : null;

  const connect = serviceWithOverride("paperVNConnect", {
    status: connectDown ? "outage" : "available",
    impact: connectDown ? "all" : "none",
    description: null,
    startAt: connectStart,
    endAt: null,
    timePrecision: connectDown ? "datetime" : null
  }, overrides, now);

  const feedback = serviceWithOverride("paperVNFeedback", {
    status: feedbackDown ? "outage" : "available",
    impact: feedbackDown ? "all" : "none",
    description: null,
    startAt: feedbackStart,
    endAt: null,
    timePrecision: feedbackDown ? "datetime" : null
  }, overrides, now);

  const connectOutage = hasActiveConnectOutage(connect, now);
  const dependentBase = {
    status: connectOutage ? "issue" as const : "available" as const,
    impact: connectOutage ? "partial" as const : "none" as const,
    description: connectOutage ? DEFAULT_DESCRIPTION : null,
    startAt: connectOutage ? connect.startAt : null,
    endAt: null,
    timePrecision: connectOutage ? "datetime" as const : null
  };

  return {
    schemaVersion: 1,
    updatedAt: iso(now),
    services: [
      serviceWithOverride("paperVNToday", dependentBase, overrides, now),
      serviceWithOverride("paperVNActivity", dependentBase, overrides, now),
      connect,
      feedback
    ]
  };
}

async function probe(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      cf: { cacheTtl: 0, cacheEverything: false },
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "Cache-Control": "no-cache",
        "User-Agent": "PaperVN-Status-Monitor/1.0"
      }
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

async function readJSON<T>(env: Env, key: string, fallback: T): Promise<T> {
  return (await env.STATUS_KV.get<T>(key, "json")) ?? fallback;
}

async function writeJSON(env: Env, key: string, value: unknown): Promise<void> {
  await env.STATUS_KV.put(key, JSON.stringify(value));
}

function initialAutoState(now: Date): AutoState {
  return {
    updatedAt: iso(now),
    probes: {
      connect: { available: true, startAt: null },
      feedback: { available: true, startAt: null }
    }
  };
}

export async function runCheck(env: Env, now = new Date()): Promise<StatusDocument> {
  let previous = await env.STATUS_KV.get<AutoState>("auto-state", "json");
  if (!previous) {
    previous = autoStateFromDocument(await readPublishedDocument(env), now);
  }
  const [connectAvailable, feedbackAvailable] = await Promise.all([
    probe(PROBE_URLS.connect),
    probe(PROBE_URLS.feedback)
  ]);
  const nextState: AutoState = {
    updatedAt: iso(now),
    probes: {
      connect: {
        available: connectAvailable,
        startAt: connectAvailable
          ? null
          : previous.probes.connect.available
            ? iso(now)
            : previous.probes.connect.startAt ?? iso(now)
      },
      feedback: {
        available: feedbackAvailable,
        startAt: feedbackAvailable
          ? null
          : previous.probes.feedback.available
            ? iso(now)
            : previous.probes.feedback.startAt ?? iso(now)
      }
    }
  };
  await writeJSON(env, "auto-state", nextState);
  const overrides = await readJSON<Overrides>(env, "overrides", {});
  const document = buildDocument(now, nextState, overrides);
  await writeJSON(env, "status", document);
  await publishToGitHub(env, document);
  return document;
}

function autoStateFromDocument(document: StatusDocument | null, now: Date): AutoState {
  const state = initialAutoState(now);
  if (!document) return state;
  for (const [probe, id] of [["connect", "paperVNConnect"], ["feedback", "paperVNFeedback"]] as const) {
    const service = document.services.find(item => item.id === id);
    if (service?.status === "outage") {
      state.probes[probe] = { available: false, startAt: service.startAt ?? iso(now) };
    }
  }
  return state;
}

async function readPublishedDocument(env: Env): Promise<StatusDocument | null> {
  try {
    const response = await fetch(env.STATUS_RAW_URL, { headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) return null;
    return await response.json() as StatusDocument;
  } catch {
    return null;
  }
}

async function publishToGitHub(env: Env, document: StatusDocument): Promise<void> {
  if (!env.GITHUB_TOKEN || env.GITHUB_TOKEN === "REPLACE_ME") return;
  const [owner, repo] = env.GITHUB_REPOSITORY.split("/");
  if (!owner || !repo) throw new Error("GITHUB_REPOSITORY must be owner/repository");
  const apiURL = `https://api.github.com/repos/${owner}/${repo}/contents/${env.GITHUB_STATUS_PATH}`;
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "PaperVN-Status-Worker",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const currentResponse = await fetch(`${apiURL}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, { headers });
  if (!currentResponse.ok) throw new Error(`GitHub read failed: ${currentResponse.status}`);
  const current = await currentResponse.json() as { sha: string; content: string };
  const currentContent = base64ToUTF8(current.content);
  try {
    const currentDocument = JSON.parse(currentContent) as StatusDocument;
    if (JSON.stringify(currentDocument.services) === JSON.stringify(document.services)) return;
  } catch {
    // Rewrite invalid or legacy content below.
  }
  const content = JSON.stringify(document, null, 2) + "\n";
  const body = {
    message: `自动更新系统状态 ${document.updatedAt}`,
    content: utf8ToBase64(content),
    sha: current.sha,
    branch: env.GITHUB_BRANCH
  };
  const writeResponse = await fetch(apiURL, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!writeResponse.ok) throw new Error(`GitHub write failed: ${writeResponse.status}`);
}

function base64ToUTF8(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function authorized(request: Request, env: Env): boolean {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.ADMIN_TOKEN) && token === env.ADMIN_TOKEN;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init.headers ?? {}) }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/status.json" || url.pathname === "/") {
      const document = await env.STATUS_KV.get<StatusDocument>("status", "json")
        ?? await readPublishedDocument(env);
      return document ? json(document, { headers: { "Cache-Control": "public, max-age=60" } }) : json({ error: "status unavailable" }, { status: 503 });
    }

    if (url.pathname === "/admin/check" && request.method === "POST") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, { status: 401 });
      return json(await runCheck(env));
    }

    if (url.pathname === "/admin/services" && request.method === "GET") {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, { status: 401 });
      return json(await readJSON<Overrides>(env, "overrides", {}));
    }

    const match = url.pathname.match(/^\/admin\/services\/([^/]+)$/);
    if (match && (request.method === "PUT" || request.method === "DELETE")) {
      if (!authorized(request, env)) return json({ error: "unauthorized" }, { status: 401 });
      const id = match[1];
      if (!isValidServiceID(id)) return json({ error: "unknown service" }, { status: 400 });
      const overrides = await readJSON<Overrides>(env, "overrides", {});
      if (request.method === "DELETE") {
        delete overrides[id];
      } else {
        const body: unknown = await request.json();
        if (!isValidOverride(body)) return json({ error: "invalid override" }, { status: 400 });
        const normalized = { ...body };
        for (const key of Object.keys(normalized) as (keyof ServiceOverride)[]) {
          if (normalized[key] === null) delete normalized[key];
        }
        const existing = overrides[id] ?? {};
        const next = { ...existing, ...normalized };
        if ((normalized.status === "issue" || normalized.status === "outage")
            && body.startAt === undefined
            && existing.startAt === undefined) {
          next.startAt = iso(new Date());
          next.timePrecision ??= "datetime";
        }
        for (const key of Object.keys(body) as (keyof ServiceOverride)[]) {
          if (body[key] === null) delete next[key];
        }
        overrides[id] = next;
      }
      await writeJSON(env, "overrides", overrides);
      return json(await runCheck(env));
    }

    return json({ error: "not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(runCheck(env));
  }
};
