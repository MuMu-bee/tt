export interface FeatureFlags { semantic_search: boolean; semantic_fallback: boolean; new_write_pipeline: boolean; organize_auto_apply: boolean; organize: { frontmatter: boolean; tags: boolean; links: boolean; format: boolean }; fiction_proposal_only: boolean }
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = { semantic_search: false, semantic_fallback: false, new_write_pipeline: false, organize_auto_apply: false, organize: { frontmatter: false, tags: false, links: false, format: false }, fiction_proposal_only: true };

export function toSearchConfig(flags: FeatureFlags): { semantic_search_enabled: boolean; semantic_fallback_enabled: boolean } {
  return { semantic_search_enabled: flags.semantic_search, semantic_fallback_enabled: flags.semantic_fallback };
}
