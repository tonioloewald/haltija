/**
 * De-duplicate the tab warnings (hidden-tab #3, focus-ambiguity #2) so a burst of untargeted
 * commands from one agent doesn't repeat the same multi-line block on every single one. That
 * repetition is the alarm-fatigue the repo's own skew-warning rationale warns about: a caveat that
 * fires on every command trains agents to ignore it, including the time it matters.
 *
 * **Why a short cooldown and not "once, forever":** the server has many clients and can't tell them
 * apart, so a permanent global suppression would hide the warning from a *second* agent that never
 * saw it — the exact "plausible-but-wrong answer with no caveat" failure these warnings exist to
 * prevent. A short cooldown collapses the one-agent burst (the real fatigue source) while keeping
 * the window in which another client could miss it tiny; the condition persists, so their next
 * command past the cooldown re-warns.
 *
 * **Why key on the whole warning string:** the text already encodes the full condition — which tab
 * answered, whether it's hidden, the exact set of other origins. So a *changed* situation (a
 * different tab, a newly-hidden tab, a new origin on the server) produces different text and is
 * never suppressed. Identical text means identical situation.
 */
export function shouldEmitWarning(
  warning: string,
  cache: Map<string, number>,
  now: number,
  cooldownMs: number,
): boolean {
  const last = cache.get(warning)
  if (last !== undefined && now - last < cooldownMs) {
    return false // same warning, still within cooldown — suppress the repeat
  }
  cache.set(warning, now)
  // Bound the cache: once it grows past a threshold, drop entries whose cooldown has elapsed (they
  // would re-warn anyway, so forgetting them changes nothing but keeps the map from growing).
  if (cache.size > 64) {
    for (const [key, ts] of cache) {
      if (now - ts >= cooldownMs) cache.delete(key)
    }
  }
  return true
}
