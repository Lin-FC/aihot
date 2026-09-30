import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { OpportunitySchema, analyzeOpportunity, enqueueManualOpportunity, enqueueStaleOpportunities } from "@aihot/backend/creator/opportunity";
import { listOpportunities, opportunityDetail } from "@aihot/backend/creator/read";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const SOURCE = `test-creator-${T}`;
const answer = {
  opportunityType: "tutorial", lifecycle: "3-7-days", audienceIntents: ["learn", "try"], targetAudience: "正在评估 AI 工具的独立创作者",
  coreAngle: "用可验证步骤判断新工具是否适合现有工作流", alternativeAngles: ["功能差异", "使用清单"],
  platforms: { wechat: { score: 82, reason: "适合深入解释" }, xiaohongshu: { score: 76, reason: "适合清单收藏" }, douyin: { score: 61, reason: "可做短演示" } },
  commercial: { score: 55, reason: "存在工具选择意图，但购买信号有限", monetizationTypes: ["affiliate"], offerIdeas: ["工具选择清单"] },
};
const provider = await stub(() => ({ id: "creator-stub", choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
Object.assign(process.env, { LLM_BASE_URL: `${provider.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "creator-test", CREATOR_OPPORTUNITY_MODEL: "default", MODEL_CALLS_ENABLED: "true" });

let eligibleId: number;
let oldId: number;

async function story(title: string, latestAt: Date, digest: string | null, mergedInto?: number) {
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, latest_at, digest, latest, merged_into) VALUES (${randomUUID()}, ${title}, ${latestAt}, ${digest}, '最新事实', ${mergedInto ?? null}) RETURNING id`;
  return s!.id;
}

async function selectedPublication(storyId: number, suffix: string) {
  const { articleId } = await upsertMaterial({ sourceId: SOURCE, url: `https://example.com/creator-${T}-${suffix}`, title: `Evidence ${suffix}`, bodyStatus: "none", via: "fetch", publishedAt: new Date() } as never);
  await sql`INSERT INTO publications (article_id, revision, visibility, eligible, selected, title, summary, score, source_id, channel, url, discovered_at, timeline_at, sort_at, story_id)
    SELECT id, revision, 'public', true, true, title, 'Evidence summary', 78, source_id, 'news', url, discovered_at, timeline_at, timeline_at, ${storyId} FROM articles WHERE id = ${articleId}`;
}

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES (${SOURCE}, 'Creator test', 'rss', 'T1', 'editorial', '2100-01-01')`;
  eligibleId = await story(`Eligible ${T}`, new Date(), "A factual digest.");
  await selectedPublication(eligibleId, "eligible");
  oldId = await story(`Old ${T}`, new Date(Date.now() - 96 * 3600_000), "Old digest.");
  await selectedPublication(oldId, "old");
  const noDigest = await story(`No digest ${T}`, new Date(), null);
  await selectedPublication(noDigest, "no-digest");
  const merged = await story(`Merged ${T}`, new Date(), "Merged digest.", eligibleId);
  await selectedPublication(merged, "merged");
});

after(async () => { await provider.close(); await stopBoss(); await closeDb(); });

test("strict output rejects out-of-range scores and invalid none combinations", () => {
  assert.equal(OpportunitySchema.safeParse({ ...answer, platforms: { ...answer.platforms, wechat: { score: 101, reason: "bad" } } }).success, false);
  assert.equal(OpportunitySchema.safeParse({ ...answer, commercial: { ...answer.commercial, monetizationTypes: ["none", "ads"] } }).success, false);
});

test("candidate scan includes only recent selected unmerged stories with a digest", async () => {
  const result = await enqueueStaleOpportunities(10);
  assert.ok(result.candidates >= 1);
  const jobs = await sql<{ data: { storyId: number } }[]>`SELECT data FROM pgboss.job WHERE name = 'creator.opportunity' AND data->>'storyId' IN (${String(eligibleId)}, ${String(oldId)})`;
  assert.ok(jobs.some((j) => Number(j.data.storyId) === eligibleId));
  assert.ok(!jobs.some((j) => Number(j.data.storyId) === oldId));
});

test("analysis is append-only, current versions are skipped, and latest analysis is read", async () => {
  const first = await analyzeOpportunity(eligibleId, { trigger: "auto" });
  assert.equal(first.analyzed, true);
  assert.equal((await analyzeOpportunity(eligibleId, { trigger: "auto" })).reason, "current");
  await analyzeOpportunity(eligibleId, { trigger: "manual", attemptTag: `manual-${T}` });
  const retry = await analyzeOpportunity(eligibleId, { trigger: "manual", attemptTag: `manual-${T}` });
  assert.equal(retry.reused, true, "a retry with the same paid request does not append history");
  const history = await sql<{ id: number; trigger: string }[]>`SELECT id, trigger FROM opportunity_analyses WHERE story_id = ${eligibleId} ORDER BY id`;
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((x) => x.trigger), ["auto", "manual"]);
  const detail = await opportunityDetail(eligibleId);
  assert.equal(detail!.analysis_id, history[1]!.id);
  assert.equal(provider.hits(), 2);
});

test("new Story and prompt versions are stale; admin reads never call the model", async () => {
  const hits = provider.hits();
  await sql`UPDATE stories SET version = version + 1 WHERE id = ${eligibleId}`;
  let detail = await opportunityDetail(eligibleId);
  assert.equal(detail!.stale, true);
  await sql`UPDATE stories SET version = ${detail!.story_version} WHERE id = ${eligibleId}`;
  const [oldReceipt] = await sql<{ id: number }[]>`INSERT INTO receipts (logical_key, service, model, purpose, subject, status, attempts)
    VALUES (${`test-old-creator-prompt-${T}`}, 'llm', 'creator-test', 'creator_opportunity', ${`story:${eligibleId}`}, 'completed', 1) RETURNING id`;
  await sql`INSERT INTO opportunity_analyses (story_id, story_version, trigger, model, prompt_version, receipt_id, opportunity_type, lifecycle, audience_intents, target_audience,
      wechat_score, xiaohongshu_score, douyin_score, commercial_score, core_angle, alternative_angles, monetization_types, platform_reasons, commercial_reason, offer_ideas, output)
    SELECT story_id, story_version, 'manual', model, 'creator-opportunity@old', ${oldReceipt!.id}, opportunity_type, lifecycle, audience_intents, target_audience,
      wechat_score, xiaohongshu_score, douyin_score, commercial_score, core_angle, alternative_angles, monetization_types, platform_reasons, commercial_reason, offer_ideas, output
    FROM opportunity_analyses WHERE id = ${detail!.analysis_id}`;
  detail = await opportunityDetail(eligibleId);
  assert.equal(detail!.stale, true);
  await listOpportunities(1);
  assert.equal(provider.hits(), hits, "list/detail are database-only");
});

test("manual command uses the Creator queue and does not delete history", async () => {
  const before = await sql`SELECT id FROM opportunity_analyses WHERE story_id = ${eligibleId}`;
  const queued = await enqueueManualOpportunity(eligibleId, `request-${T}`);
  assert.ok(queued?.jobId);
  const [job] = await sql<{ name: string; data: { storyId: number; trigger: string } }[]>`SELECT name, data FROM pgboss.job WHERE id = ${queued!.jobId}`;
  assert.equal(job!.name, "creator.opportunity");
  assert.deepEqual(job!.data, { storyId: eligibleId, trigger: "manual", attemptTag: `admin:request-${T}` });
  const afterRows = await sql`SELECT id FROM opportunity_analyses WHERE story_id = ${eligibleId}`;
  assert.equal(afterRows.length, before.length);
});
