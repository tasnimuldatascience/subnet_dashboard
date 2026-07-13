export type SingleFlightState<T> = {
  current: Promise<T> | null
}

/**
 * Share one asynchronous operation across concurrent callers. The flight is
 * cleared after either success or failure so the next caller can refresh.
 */
export function runSingleFlight<T>(
  state: SingleFlightState<T>,
  operation: () => Promise<T>,
): Promise<T> {
  if (state.current) return state.current

  const current = Promise.resolve().then(operation)
  state.current = current

  const clear = () => {
    if (state.current === current) state.current = null
  }
  void current.then(clear, clear)

  return current
}
