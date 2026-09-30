import { z } from "zod";
import { sql } from "../db.ts";
import { modelFor } from "../editorial/models.ts";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import { enqueue, QUEUES } from "../jobs/queue.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt } from "../providers/receipts.ts";
import { audit } from "../admin/auth.ts";

const Intent = z.enum(["news", "learn", "solve_problem", "compare", "try", "buy", "download", "make_money", "curiosity", "controversy"]);
const Monetization = z.enum(["ads", "sponsorship", "affiliate", "digital_product", "course", "consulting", "community", "saas", "ecommerce", "none"]);
const Platform = z.object({ score: z.number().int().min(0).max(100), reason: z.string().min(1).max(500) }).strict();
export const OpportunitySchema = z.object({
  opportunityType: z.enum(["breaking", "evergreen", "tutorial", "comparison", "trend", "commercial"]),
  lifecycle: z.enum(["hours", "1-2-days", "3-7-days", "evergreen"]),
  audienceIntents: z.array(Intent).min(1).max(4),
  targetAudience: z.string().min(1).max(500),
  coreAngle: z.string().min(1).max(1000),
  alternativeAngles: z.array(z.string().min(1).max(1000)).max(3),
  platforms: z.object({ wechat: Platform, xiaohongshu: Platform, douyin: Platform }).strict(),
  commercial: z.object({
    score: z.number().int().min(0).max(100), reason: z.string().min(1).max(500),
    monetizationTypes: z.array(Monetization).min(1).refine((v) => !v.includes("none") || v.length === 1, "none must be exclusive"),
    offerIdeas: z.array(z.string().min(1).max(1000)).max(3),
  }).strict(),
}).strict();

export const CREATOR_PROMPT_VERSION = () => promptVersion("creator-opportunity");

export interface StoryMaterial {
  id: number; title: string; digest: string; latest: string | null; version: number;
  evidence: Array<{ title: string; summary: string | null; source: string; publishedAt: string | null }>;
}

export async function loadStoryMaterial(storyId: number): Promise<StoryMaterial | null> {
  const [story] = await sql<Omit<StoryMaterial, "evidence">[]>`
    SELECT id, title, digest, latest, version FROM stories
    WHERE id = ${storyId} AND merged_into IS NULL AND nullif(btrim(digest), '') IS NOT NULL`;
  if (!story) return null;
  const evidence = await sql<StoryMaterial["evidence"]>`
    SELECT p.title, p.summary, s.name AS source, coalesce(p.published_at, p.timeline_at)::text AS "publishedAt"
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE p.story_id = ${storyId} AND p.selected AND p.visibility = 'public'
    ORDER BY p.first_party DESC, p.score DESC NULLS LAST, p.timeline_at DESC LIMIT 5`;
  return { ...story, evidence };
}

export async function analyzeOpportunity(storyId: number, opts: { trigger: "auto" | "manual"; attemptTag?: string }) {
  const material = await loadStoryMaterial(storyId);
  if (!material || !material.evidence.length) return { analyzed: false, reason: "ineligible" };
  const version = CREATOR_PROMPT_VERSION();
  if (opts.trigger === "auto") {
    const [current] = await sql`SELECT 1 FROM opportunity_analyses WHERE story_id = ${storyId} AND story_version >= ${material.version} AND prompt_version = ${version} LIMIT 1`;
    if (current) return { analyzed: false, reason: "current" };
  }
  const model = await modelFor("creatorOpportunity");
  const result = await chatJson({
    model, purpose: "creator_opportunity", subject: `story:${storyId}:v${material.version}`,
    promptVersion: version, system: promptText("creator-opportunity"), user: JSON.stringify(material),
    schema: OpportunitySchema, maxTokens: 1800, attemptTag: opts.attemptTag,
  });
  const o = result.data;
  const analysisId = await sql.begin(async (tx) => {
    await tx`INSERT INTO content_opportunities (story_id, status) VALUES (${storyId}, 'new') ON CONFLICT (story_id) DO NOTHING`;
    const inserted = await tx<{ id: number }[]>`INSERT INTO opportunity_analyses
      (story_id, story_version, trigger, model, prompt_version, receipt_id, opportunity_type, lifecycle, audience_intents, target_audience,
       wechat_score, xiaohongshu_score, douyin_score, commercial_score, core_angle, alternative_angles, monetization_types,
       platform_reasons, commercial_reason, offer_ideas, output)
      VALUES (${storyId}, ${material.version}, ${opts.trigger}, ${result.model}, ${version}, ${result.receiptId}, ${o.opportunityType}, ${o.lifecycle}, ${o.audienceIntents}, ${o.targetAudience},
       ${o.platforms.wechat.score}, ${o.platforms.xiaohongshu.score}, ${o.platforms.douyin.score}, ${o.commercial.score}, ${o.coreAngle}, ${o.alternativeAngles}, ${o.commercial.monetizationTypes},
       ${tx.json({ wechat: o.platforms.wechat.reason, xiaohongshu: o.platforms.xiaohongshu.reason, douyin: o.platforms.douyin.reason })}, ${o.commercial.reason}, ${o.commercial.offerIdeas}, ${tx.json(o)})
      ON CONFLICT (receipt_id) DO NOTHING RETURNING id`;
    const [existing] = inserted.length ? inserted : await tx<{ id: number }[]>`SELECT id FROM opportunity_analyses WHERE receipt_id = ${result.receiptId}`;
    await tx`UPDATE content_opportunities SET status = 'analyzed', updated_at = now() WHERE story_id = ${storyId}`;
    await completeReceipt(tx, result.receiptId);
    return { id: existing!.id, inserted: inserted.length > 0 };
  });
  return { analyzed: analysisId.inserted, analysisId: analysisId.id, reused: !analysisId.inserted };
}

export async function enqueueStaleOpportunities(limit = 10) {
  const version = CREATOR_PROMPT_VERSION();
  const rows = await sql<{ id: number; story_version: number }[]>`
    SELECT s.id, s.version AS story_version FROM stories s
    WHERE s.merged_into IS NULL AND nullif(btrim(s.digest), '') IS NOT NULL
      AND s.latest_at >= now() - interval '72 hours'
      AND EXISTS (SELECT 1 FROM publications p WHERE p.story_id = s.id AND p.selected AND p.visibility = 'public')
      AND NOT EXISTS (SELECT 1 FROM opportunity_analyses a WHERE a.story_id = s.id AND a.story_version >= s.version AND a.prompt_version = ${version})
    ORDER BY s.latest_at DESC LIMIT ${Math.max(1, Math.min(limit, 50))}`;
  let enqueued = 0;
  for (const row of rows) {
    await sql`INSERT INTO content_opportunities (story_id, status) VALUES (${row.id}, 'new') ON CONFLICT (story_id) DO NOTHING`;
    if (await enqueue(QUEUES.creatorOpportunity, { storyId: row.id, trigger: "auto" }, { singletonKey: `story:${row.id}:v${row.story_version}:${version}` })) enqueued++;
  }
  return { candidates: rows.length, enqueued };
}

export async function enqueueManualOpportunity(storyId: number, requestId: string, actor = "system") {
  if (!/^[\w-]{8,80}$/.test(requestId)) throw new Error("a stable request id is required");
  const [story] = await sql`SELECT 1 FROM stories WHERE id = ${storyId} AND merged_into IS NULL`;
  if (!story) return null;
  const jobId = await enqueue(QUEUES.creatorOpportunity, { storyId, trigger: "manual", attemptTag: `admin:${requestId}` }, { singletonKey: `manual:story:${storyId}:${requestId}` });
  await audit(actor, "creator.opportunity.analyze", `story:${storyId}`, null, null, { jobId, requestId }, requestId);
  return { jobId };
}
