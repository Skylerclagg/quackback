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
