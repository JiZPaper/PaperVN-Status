import test from "node:test";
import assert from "node:assert/strict";
import { buildDocument } from "../src/index.ts";

const now = new Date("2026-08-24T08:00:00.000Z");
const healthy = {
  updatedAt: now.toISOString(),
  probes: {
    connect: { available: true, startAt: null },
    feedback: { available: true, startAt: null }
  }
};

test("healthy probes produce the four configured services", () => {
  const document = buildDocument(now, healthy, {});
  assert.deepEqual(document.services.map(service => service.id), [
    "paperVNToday", "paperVNActivity", "paperVNConnect", "paperVNFeedback"
  ]);
  assert.equal(document.services.every(service => service.status === "available"), true);
});

test("Connect outage cascades to Today and activity", () => {
  const document = buildDocument(now, {
    ...healthy,
    probes: { ...healthy.probes, connect: { available: false, startAt: "2026-08-24T07:00:00.000Z" } }
  }, {});
  for (const id of ["paperVNToday", "paperVNActivity"]) {
    const service = document.services.find(item => item.id === id);
    assert.equal(service.status, "issue");
    assert.equal(service.impact, "partial");
    assert.equal(service.description.default, "中国大陆用户目前在使用此服务时可能遇到无法载入的问题。");
  }
  const connect = document.services.find(item => item.id === "paperVNConnect");
  assert.equal(connect.status, "outage");
  assert.equal(connect.impact, "all");
});

test("manual fields override automatic values independently", () => {
  const document = buildDocument(now, {
    ...healthy,
    probes: { ...healthy.probes, connect: { available: false, startAt: "2026-08-24T07:00:00.000Z" } }
  }, {
    paperVNConnect: { status: "available", description: "维护中", impact: "partial" },
    paperVNFeedback: { status: "outage", startAt: "2026-08-25T10:00:00.000Z", endAt: "2026-08-25T12:00:00.000Z" }
  });
  const connect = document.services.find(item => item.id === "paperVNConnect");
  assert.equal(connect.status, "available");
  assert.equal(connect.description, "维护中");
  assert.equal(connect.impact, "partial");
  assert.equal(document.services.find(item => item.id === "paperVNToday").status, "available");
  const feedback = document.services.find(item => item.id === "paperVNFeedback");
  assert.equal(feedback.status, "outage");
  assert.equal(feedback.startAt, "2026-08-25T10:00:00.000Z");
});
