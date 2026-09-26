/**
 * Does an identity-provider row point at Microsoft Entra ID? Shared by the
 * server (Graph directory access) and the admin UI (which controls to show),
 * so both sides recognise the same providers.
 *
 * `kind='entra'` is trusted; a kind naming another IdP family is rejected; an
 * 'other' or legacy-null kind falls through to URL sniffing across the known
 * Microsoft authority hosts (workforce, External ID / CIAM, the v1 issuer).
 */
export function isEntraProviderShape(provider: {
  kind: string | null
  discoveryUrl: string | null
  issuer: string | null
  tokenUrl: string | null
}): boolean {
  if (provider.kind === 'entra') return true
  if (provider.kind && provider.kind !== 'other') return false
  const urls = [provider.discoveryUrl, provider.issuer, provider.tokenUrl]
  return urls.some(
    (u) =>
      !!u &&
      (u.includes('login.microsoftonline.com') ||
        u.includes('.ciamlogin.com') ||
        u.includes('sts.windows.net'))
  )
}
