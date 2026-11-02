/** A Convex-hosted frontend always belongs to the backend with the same slug. */
export function backendUrl(hostname: string, configured?: string): string | undefined {
  return hostname.endsWith(".convex.site")
    ? `https://${hostname.replace(/\.convex\.site$/, ".convex.cloud")}`
    : configured;
}
