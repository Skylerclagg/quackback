/**
 * The assistant's configured display name, for copy that lives outside React.
 *
 * Components use `useAssistantName()`. Static label tables (workflow step
 * labels, nav items, template chips) cannot call a hook, so they read this
 * store lazily instead; the hook keeps it in sync with the identity query,
 * which the admin shell mounts so the name has usually resolved before a
 * page renders. Until then the default shows.
 */
export const DEFAULT_ASSISTANT_NAME = 'Quinn'

let current = DEFAULT_ASSISTANT_NAME

/** The configured name, or the default until the identity query resolves. */
export function assistantName(): string {
  return current
}

export function setAssistantName(name: string | null | undefined): void {
  current = name?.trim() || DEFAULT_ASSISTANT_NAME
}

/**
 * Copy is written with the default name; swap it for the configured one at
 * render. A no-op when the workspace kept the default.
 */
export function withAssistantName(text: string, name: string = current): string {
  return name === DEFAULT_ASSISTANT_NAME ? text : text.replaceAll(DEFAULT_ASSISTANT_NAME, name)
}

/**
 * The same swap, applied to what `intl.formatMessage` RETURNS.
 *
 * Applying it to the `defaultMessage` going in does not work: react-intl
 * resolves by `id` against the loaded catalog first, and the catalog carries
 * the authored default name, so the substituted default is never consulted.
 * Only the rendered output is guaranteed to be the string the user sees.
 *
 * Handles both shapes formatMessage can return. With plain values it is a
 * string; with rich values (a message carrying <b> or a <Link>) it is an array
 * of strings and React nodes, and only the string chunks can be swapped — the
 * nodes are already-rendered elements. A name split across two chunks would be
 * missed, which cannot happen here because the default is a single word and
 * ICU only splits at placeholder boundaries.
 */
export function formattedWithAssistantName<T>(formatted: T, name: string = current): T {
  if (name === DEFAULT_ASSISTANT_NAME) return formatted
  if (typeof formatted === 'string') {
    return formatted.replaceAll(DEFAULT_ASSISTANT_NAME, name) as unknown as T
  }
  if (Array.isArray(formatted)) {
    return formatted.map((part) =>
      typeof part === 'string' ? part.replaceAll(DEFAULT_ASSISTANT_NAME, name) : part
    ) as unknown as T
  }
  return formatted
}
