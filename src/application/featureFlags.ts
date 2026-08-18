export interface MemoryFeatureFlags { enabled: boolean; captureL0: boolean; autoExtract: boolean; autoRecall: boolean; recallDepth: 'l1' | 'l2' | 'l3' }
export const DEFAULT_MEMORY_FEATURE_FLAGS: MemoryFeatureFlags = { enabled: false, captureL0: false, autoExtract: false, autoRecall: false, recallDepth: 'l3' };
export interface FeatureFlags { semantic_search: boolean; semantic_fallback: boolean; new_write_pipeline: boolean; organize_auto_apply: boolean; organize: { frontmatter: boolean; tags: boolean; links: boolean; format: boolean }; fiction_proposal_only: boolean; memory: MemoryFeatureFlags }
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = { semantic_search: false, semantic_fallback: false, new_write_pipeline: false, organize_auto_apply: false, organize: { frontmatter: false, tags: false, links: false, format: false }, fiction_proposal_only: true, memory: { ...DEFAULT_MEMORY_FEATURE_FLAGS } };

export function toSearchConfig(flags: FeatureFlags): { semantic_search_enabled: boolean; semantic_fallback_enabled: boolean } {
  return { semantic_search_enabled: flags.semantic_search, semantic_fallback_enabled: flags.semantic_fallback };
}
