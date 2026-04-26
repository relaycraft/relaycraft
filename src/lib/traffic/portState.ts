/**
 * Shared backend port state — breaks the circular dependency between
 * trafficPoller and flowService (both need the port, neither should
 * import the other).
 */

let currentPort = 9090;

export function getBackendPort(): number {
  return currentPort;
}

export function setBackendPort(port: number) {
  currentPort = port;
}
