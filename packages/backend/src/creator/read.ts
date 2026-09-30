import { sql } from "../db.ts";
import { CREATOR_PROMPT_VERSION } from "./opportunity.ts";

const latestColumns = `a.id AS analysis_id, a.story_version, a.trigger, a.model, a.prompt_version,
  a.opportunity_type, a.lifecycle, a.audience_intents, a.target_audience,
  a.wechat_score, a.xiaohongshu_score, a.douyin_score, a.commercial_score,
  a.core_angle, a.alternative_angles, a.monetization_types, a.platform_reasons,
  a.commercial_reason, a.offer_ideas, a.created_at AS analyzed_at`;

export async function listOpportunities(page = 1, pageSize = 20) {
  const offset = (Math.max(1, page) - 1) * pageSize;
  const version = CREATOR_PROMPT_VERSION();
  const rows = await sql.unsafe(`
    SELECT s.id AS story_id, s.public_id, s.title, s.latest_at, s.version, c.status,
      ${latestColumns},
      greatest(a.wechat_score, a.xiaohongshu_score, a.douyin_score) AS strongest_platform_score,
      coalesce((SELECT max(p.score) FROM publications p WHERE p.story_id = s.id AND p.selected AND p.visibility = 'public'), 0) AS attention,
      (SELECT h.heat FROM story_heat_hourly h WHERE h.story_id = s.id ORDER BY h.hour DESC LIMIT 1) AS heat,
      (a.story_version < s.version OR a.prompt_version <> $1) AS stale
    FROM content_opportunities c JOIN stories s ON s.id = c.story_id
    JOIN LATERAL (SELECT * FROM opportunity_analyses x WHERE x.story_id = s.id ORDER BY x.id DESC LIMIT 1) a ON true
    WHERE c.status <> 'archived' AND s.merged_into IS NULL
    ORDER BY greatest(a.wechat_score, a.xiaohongshu_score, a.douyin_score) DESC, a.commercial_score DESC, s.latest_at DESC
    LIMIT $2 OFFSET $3`, [version, pageSize, offset]);
  const [count] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM content_opportunities c JOIN stories s ON s.id = c.story_id WHERE c.status <> 'archived' AND s.merged_into IS NULL AND EXISTS (SELECT 1 FROM opportunity_analyses a WHERE a.story_id = s.id)`;
  return { page: Math.max(1, page), pageSize, total: count!.total, rows };
}

export async function opportunityDetail(storyId: number): Promise<Record<string, any> | null> {
  const version = CREATOR_PROMPT_VERSION();
  const [row] = await sql.unsafe(`
    SELECT s.id AS story_id, s.public_id, s.title, s.digest, s.latest, s.latest_at, s.version, c.status,
      ${latestColumns},
      coalesce((SELECT max(p.score) FROM publications p WHERE p.story_id = s.id AND p.selected AND p.visibility = 'public'), 0) AS attention,
      (SELECT h.heat FROM story_heat_hourly h WHERE h.story_id = s.id ORDER BY h.hour DESC LIMIT 1) AS heat,
      (a.story_version < s.version OR a.prompt_version <> $1) AS stale
    FROM content_opportunities c JOIN stories s ON s.id = c.story_id
    JOIN LATERAL (SELECT * FROM opportunity_analyses x WHERE x.story_id = s.id ORDER BY x.id DESC LIMIT 1) a ON true
    WHERE s.id = $2 AND s.merged_into IS NULL`, [version, storyId]);
  if (!row) return null;
  const evidence = await sql`
    SELECT p.article_id, p.title, p.summary, p.url, p.published_at, p.timeline_at, p.score, s.name AS source
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE p.story_id = ${storyId} AND p.selected AND p.visibility = 'public'
    ORDER BY p.first_party DESC, p.score DESC NULLS LAST, p.timeline_at DESC LIMIT 10`;
  const history = await sql`SELECT id, story_version, trigger, model, prompt_version, created_at FROM opportunity_analyses WHERE story_id = ${storyId} ORDER BY id DESC`;
  return { ...(row as unknown as Record<string, unknown>), evidence, history };
}
