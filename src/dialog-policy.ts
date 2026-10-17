/**
 * Which values `/dialog/configure` accepts (#3274). One place, so the widget refuses exactly what
 * it would not act on, and the CLI and docs name the same set.
 */
export const DIALOG_POLICY_VALUES = {
  alert: ['dismiss', 'show'],
  confirm: ['accept', 'dismiss', 'show'],
  prompt: ['dismiss', 'show', '{ "response": "text" }'],
  beforeunload: ['allow', 'block'],
} as const

/** Null when every field present is one the widget acts on; otherwise what is wrong with it. */
export function dialogPolicyError(payload: Record<string, unknown> | null | undefined): string | null {
  if (!payload) return null
  for (const key of ['alert', 'confirm', 'beforeunload'] as const) {
    const v = payload[key]
    if (v !== undefined && !(DIALOG_POLICY_VALUES[key] as readonly string[]).includes(v as string)) {
      return `dialog ${key} must be one of ${DIALOG_POLICY_VALUES[key].map((x) => `"${x}"`).join(', ')}; got ${JSON.stringify(v)}`
    }
  }
  const p = payload.prompt
  if (p !== undefined && p !== 'dismiss' && p !== 'show' &&
      !(p && typeof p === 'object' && typeof (p as { response?: unknown }).response === 'string')) {
    return `dialog prompt must be "dismiss", "show" or { "response": "text" }; got ${JSON.stringify(p)}`
  }
  return null
}
