-- Story-level Creator Opportunity state and append-only analysis history.
CREATE TABLE content_opportunities (
  story_id          bigint PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'analyzed', 'archived')),
  first_eligible_at timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE opportunity_analyses (
  id                   bigserial PRIMARY KEY,
  story_id             bigint NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  story_version        integer NOT NULL,
  trigger              text NOT NULL CHECK (trigger IN ('auto', 'manual')),
  model                text NOT NULL,
  prompt_version       text NOT NULL,
  receipt_id           bigint NOT NULL REFERENCES receipts (id),
  opportunity_type     text NOT NULL CHECK (opportunity_type IN ('breaking', 'evergreen', 'tutorial', 'comparison', 'trend', 'commercial')),
  lifecycle            text NOT NULL CHECK (lifecycle IN ('hours', '1-2-days', '3-7-days', 'evergreen')),
  audience_intents     text[] NOT NULL CHECK (cardinality(audience_intents) BETWEEN 1 AND 4 AND audience_intents <@ ARRAY['news','learn','solve_problem','compare','try','buy','download','make_money','curiosity','controversy']::text[]),
  target_audience      text NOT NULL,
  wechat_score         smallint NOT NULL CHECK (wechat_score BETWEEN 0 AND 100),
  xiaohongshu_score    smallint NOT NULL CHECK (xiaohongshu_score BETWEEN 0 AND 100),
  douyin_score         smallint NOT NULL CHECK (douyin_score BETWEEN 0 AND 100),
  commercial_score     smallint NOT NULL CHECK (commercial_score BETWEEN 0 AND 100),
  core_angle           text NOT NULL,
  alternative_angles   text[] NOT NULL DEFAULT '{}' CHECK (cardinality(alternative_angles) <= 3),
  monetization_types   text[] NOT NULL DEFAULT '{}' CHECK (cardinality(monetization_types) >= 1 AND monetization_types <@ ARRAY['ads','sponsorship','affiliate','digital_product','course','consulting','community','saas','ecommerce','none']::text[] AND (NOT ('none' = ANY(monetization_types)) OR cardinality(monetization_types) = 1)),
  platform_reasons     jsonb NOT NULL,
  commercial_reason    text NOT NULL,
  offer_ideas           text[] NOT NULL DEFAULT '{}' CHECK (cardinality(offer_ideas) <= 3),
  output                jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX opportunity_analyses_story_latest_idx ON opportunity_analyses (story_id, id DESC);
CREATE INDEX opportunity_analyses_story_version_idx ON opportunity_analyses (story_id, story_version DESC, created_at DESC);
CREATE UNIQUE INDEX opportunity_analyses_receipt_idx ON opportunity_analyses (receipt_id);
