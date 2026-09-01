CREATE TABLE IF NOT EXISTS taxonomy.categories (
  category_id varchar(64) PRIMARY KEY,
  schema_version varchar(32) NOT NULL,
  name varchar(80) NOT NULL,
  description varchar(1000) NOT NULL,
  display_order smallint NOT NULL CHECK (display_order >= 0),
  status varchar(16) NOT NULL CHECK (status IN ('active','hidden','restricted')),
  dictionary_version bigint NOT NULL DEFAULT 1 CHECK (dictionary_version >= 1),
  published_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (category_id, schema_version)
    REFERENCES taxonomy.category_schema_versions(category_id, schema_version),
  CHECK (updated_at >= published_at)
);

CREATE TABLE IF NOT EXISTS taxonomy.topics (
  topic_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id varchar(64) NOT NULL REFERENCES taxonomy.categories(category_id),
  canonical_slug varchar(80) NOT NULL UNIQUE
    CHECK (canonical_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name varchar(80) NOT NULL,
  description varchar(1000) NOT NULL,
  config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  filter_snapshot_json jsonb NOT NULL,
  display_order smallint NOT NULL CHECK (display_order >= 0),
  status varchar(16) NOT NULL CHECK (status IN ('active','hidden','restricted','retired')),
  dictionary_version bigint NOT NULL DEFAULT 1 CHECK (dictionary_version >= 1),
  published_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (category_id, display_order),
  CHECK (jsonb_typeof(config_json) = 'object'),
  CHECK (jsonb_typeof(filter_snapshot_json) = 'object'),
  CHECK (updated_at >= published_at)
);

CREATE INDEX IF NOT EXISTS taxonomy_topics_public_idx
  ON taxonomy.topics(category_id, status, display_order, topic_id);

CREATE TABLE IF NOT EXISTS taxonomy.topic_aliases (
  alias_slug varchar(80) PRIMARY KEY
    CHECK (alias_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  target_topic_id uuid NOT NULL REFERENCES taxonomy.topics(topic_id),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.featured_project_placements (
  placement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surface varchar(32) NOT NULL CHECK (surface IN ('projects_home')),
  project_id uuid NOT NULL REFERENCES catalog.projects(project_id),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  reason_key varchar(80) NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('scheduled','active','ended','cancelled')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (surface, position, starts_at),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS featured_project_placements_active_idx
  ON catalog.featured_project_placements(surface, status, starts_at, ends_at, position);

INSERT INTO taxonomy.categories (
  category_id,schema_version,name,description,display_order,status,
  dictionary_version,published_at,updated_at
) VALUES
  ('ai_learning_quiz','learning.v1','AI 学习与练习工具',
   '围绕材料处理、题目生成、练习、反馈与学习记录探索公开作品。',10,'active',1,now(),now()),
  ('personal_site_portfolio','portfolio.v1','个人主页与作品集',
   '从身份、内容结构、视觉、交互和可复用资产探索公开个人网站。',20,'active',1,now(),now())
ON CONFLICT (category_id) DO NOTHING;

INSERT INTO taxonomy.topics (
  topic_id,category_id,canonical_slug,name,description,config_json,
  filter_snapshot_json,display_order,status,dictionary_version,published_at,updated_at
) VALUES
  ('38000000-0000-4000-8000-000000000001','personal_site_portfolio','personal-sites-portfolios',
   '个人主页与作品集','从身份、内容结构、视觉和实现方式寻找建站参考',
   '{"solution_paths":["按创作者身份与建站目的探索","按结构、视觉与可复用资产查同类"]}',
   '{"category_id":"personal_site_portfolio","category_fields":{}}',10,'active',1,now(),now()),
  ('38000000-0000-4000-8000-000000000002','ai_learning_quiz','ai-question-generation',
   'AI 出题','把已有材料快速变成可练习的问题',
   '{"solution_paths":["解析材料后生成题目","基于预设知识点组织练习"]}',
   '{"category_id":"ai_learning_quiz","category_fields":{"use_scenarios":["question_generation"]}}',20,'active',1,now(),now()),
  ('38000000-0000-4000-8000-000000000003','ai_learning_quiz','pdf-to-quiz',
   'PDF 转题库','把 PDF 讲义或试卷转换为题库',
   '{"solution_paths":["直接解析文字 PDF","OCR 处理扫描 PDF"]}',
   '{"category_id":"ai_learning_quiz","category_fields":{"use_scenarios":["question_generation"],"main_inputs":["pdf"]}}',30,'active',1,now(),now()),
  ('38000000-0000-4000-8000-000000000004','ai_learning_quiz','daily-practice',
   '刷题','持续完成小批量练习并获得反馈','{}',
   '{"category_id":"ai_learning_quiz","category_fields":{"use_scenarios":["daily_practice"]}}',40,'active',1,now(),now()),
  ('38000000-0000-4000-8000-000000000005','ai_learning_quiz','mock-exam',
   '模拟考试','在接近考试的约束下完成整套练习','{}',
   '{"category_id":"ai_learning_quiz","category_fields":{"use_scenarios":["mock_exam"]}}',50,'active',1,now(),now()),
  ('38000000-0000-4000-8000-000000000006','ai_learning_quiz','vocabulary-review',
   '背词','记忆词汇并安排后续复习','{}',
   '{"category_id":"ai_learning_quiz","category_fields":{"use_scenarios":["vocabulary_memory"]}}',60,'active',1,now(),now()),
  ('38000000-0000-4000-8000-000000000007','ai_learning_quiz','speaking-practice',
   '口语','练习口语表达并获得结构化反馈','{}',
   '{"category_id":"ai_learning_quiz","category_fields":{"use_scenarios":["speaking_mock_exam"]}}',70,'active',1,now(),now()),
  ('38000000-0000-4000-8000-000000000008','ai_learning_quiz','dictation-training',
   '听写','通过音频输入训练听辨和拼写','{}',
   '{"category_id":"ai_learning_quiz","category_fields":{"use_scenarios":["dictation_training"]}}',80,'active',1,now(),now()),
  ('38000000-0000-4000-8000-000000000009','ai_learning_quiz','mistake-review',
   '错题复习','收集错题并组织再次练习','{}',
   '{"category_id":"ai_learning_quiz","category_fields":{"use_scenarios":["mistake_review"]}}',90,'active',1,now(),now())
ON CONFLICT (topic_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS events_public_feed_idx
  ON catalog.events(event_sort_at DESC,event_id DESC,project_id)
  WHERE supersedes_event_id IS NULL;

CREATE OR REPLACE FUNCTION taxonomy.reject_published_dictionary_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.dictionary_version = NEW.dictionary_version
     AND to_jsonb(OLD) - ARRAY['updated_at']::text[]
         IS DISTINCT FROM to_jsonb(NEW) - ARRAY['updated_at']::text[] THEN
    RAISE EXCEPTION 'DICTIONARY_VERSION_REQUIRED' USING ERRCODE = '40001';
  END IF;
  IF NEW.dictionary_version <= OLD.dictionary_version THEN
    RAISE EXCEPTION 'DICTIONARY_VERSION_NOT_ADVANCED' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS taxonomy_categories_version_guard ON taxonomy.categories;
CREATE TRIGGER taxonomy_categories_version_guard
  BEFORE UPDATE ON taxonomy.categories
  FOR EACH ROW EXECUTE FUNCTION taxonomy.reject_published_dictionary_mutation();

DROP TRIGGER IF EXISTS taxonomy_topics_version_guard ON taxonomy.topics;
CREATE TRIGGER taxonomy_topics_version_guard
  BEFORE UPDATE ON taxonomy.topics
  FOR EACH ROW EXECUTE FUNCTION taxonomy.reject_published_dictionary_mutation();
