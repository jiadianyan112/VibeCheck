import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CatalogError } from './errors.js'
import { parseProjectSnapshot } from './validation.js'

const core = {
  current_name: 'Portfolio Alpha',
  public_url: 'https://portfolio.example.com',
  repository_url: null,
  original_platform: null,
  cover_media_reference_ids: ['cover-reference'],
  one_line_definition: '展示设计与开发案例的个人主页',
  ai_coding_tools: {
    knowledge_state: 'known_empty',
    values: [],
    source_type: 'verified_author_statement',
    observed_at: '2026-08-10T00:00:00.000Z',
  },
  tech_stack: ['React'],
  deployment_platform: 'Render',
  access_status: 'normal',
  maintenance_signal: 'author_updated',
  status_note: null,
}

const portfolioP0 = {
  site_type: 'portfolio',
  creator_roles: ['designer'],
  primary_goals: ['showcase_projects'],
  page_model: 'multi_page',
  navigation_pattern: null,
  homepage_sequence: [],
  core_modules: ['hero', 'projects'],
  project_showcase_format: 'case_study_list',
  case_study_depth: 'deep',
  visual_styles: ['editorial'],
  layout_patterns: ['editorial_grid'],
  color_character: 'neutral',
  theme_mode: 'light_only',
  interaction_level: 'light',
  interaction_patterns: ['microinteraction'],
  responsive_support: 'confirmed',
  blog_support: 'none',
}

describe('category schema validation', () => {
  it('accepts the frozen Portfolio P0 field set', () => {
    const parsed = parseProjectSnapshot({
      project_core: core,
      category_id: 'personal_site_portfolio',
      category_schema_version: 'portfolio.v1',
      category_data: portfolioP0,
    }, 'personal_site_portfolio', 'portfolio.v1')
    assert.equal(parsed.category_data.site_type, 'portfolio')
  })

  it('rejects legacy Learning root fields and strips valid P1 fields from the P0 projection', () => {
    assert.throws(
      () => parseProjectSnapshot({
        project_core: { ...core, target_users: ['university_students'] },
        category_id: 'personal_site_portfolio',
        category_schema_version: 'portfolio.v1',
        category_data: {},
      }, 'personal_site_portfolio', 'portfolio.v1'),
      (error: unknown) => error instanceof CatalogError && error.code === 'CATALOG_SNAPSHOT_INVALID',
    )
    const parsed = parseProjectSnapshot({
      project_core: core,
      category_id: 'personal_site_portfolio',
      category_schema_version: 'portfolio.v1',
      category_data: { ...portfolioP0, cms_support: 'headless' },
    }, 'personal_site_portfolio', 'portfolio.v1')
    assert.equal('cms_support' in parsed.category_data, false)
  })
})
