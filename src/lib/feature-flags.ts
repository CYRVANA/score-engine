/**
 * Feature flags for score-engine.
 *
 * Currently gates only the destinations system (Phase 2.5+), which has
 * meaningful operational complexity (Edge Function deployment, pg_cron,
 * encryption key management). The flag exists so that future open-source
 * releases can ship without destinations enabled, while hosted/production
 * deployments turn it on via env var.
 *
 * See docs/ARCHITECTURE.md and the strategy discussion in PHASE_2_5_RETRO
 * (forthcoming) for background.
 *
 * To enable destinations in your deployment, set in your environment:
 *   FEATURE_DESTINATIONS=true
 *
 * Any other value (or absent) disables the feature. The destinations data
 * model remains intact in the database regardless — only the UI surface and
 * the enqueue logic in captureLead are gated.
 */

export function isDestinationsEnabled(): boolean {
  return process.env.FEATURE_DESTINATIONS === "true";
}
