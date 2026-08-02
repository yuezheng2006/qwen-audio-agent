/** Process-wide active capability registry (set during bootstrap). */

let activeRegistry = null

export function setActiveCapabilityRegistry(registry) {
  activeRegistry = registry || null
  return activeRegistry
}

export function getActiveCapabilityRegistry() {
  return activeRegistry
}
