WITH defaults(config_key, value_json) AS (
  VALUES
    ('community.comment_create_rate_limit', '{"limit":3,"window_seconds":60}'::jsonb),
    ('community.comment_report_rate_limit', '{"limit":2,"window_seconds":60}'::jsonb)
), missing AS (
  SELECT defaults.config_key,
    defaults.value_json,
    COALESCE(MAX(existing.version), 0) + 1 AS version
  FROM defaults
  LEFT JOIN ops.config_versions AS existing
    ON existing.config_key = defaults.config_key
  GROUP BY defaults.config_key, defaults.value_json
  HAVING COUNT(*) FILTER (WHERE existing.status = 'published') = 0
)
INSERT INTO ops.config_versions (
  config_key, version, status, value_json, schema_version, content_hash, published_at
)
SELECT missing.config_key,
  missing.version,
  'published',
  missing.value_json,
  'community.rate_limit.v1',
  encode(digest(missing.value_json::text, 'sha256'), 'hex'),
  now()
FROM missing
ON CONFLICT DO NOTHING;
