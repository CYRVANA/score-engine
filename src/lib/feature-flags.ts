/**
 * Feature flags for score-engine.
 *
 * Gates features with operational complexity (Edge Function deployment, secret
 * management, external API dependencies) so open-source/community deployments
 * can ship without those features active.
 *
 * To enable destinations (Phase 2.5+) in your deployment:
 *   FEATURE_DESTINATIONS=true
 * To enable AI narratives (Phase 3a+) in your deployment:
 *   FEATURE_AI_NARRATIVES=true
 *
 * Any other value (or absent) disables the feature. Database schema remains
 * intact regardless — only UI surfaces and worker enqueue logic are gated.
 */

export function isDestinationsEnabled(): boolean {
  return process.env.FEATURE_DESTINATIONS === "true";
}

export function isAiNarrativesEnabled(): boolean {
  return process.env.FEATURE_AI_NARRATIVES === "true";
}
