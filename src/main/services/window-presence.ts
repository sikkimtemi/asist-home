import mitt from 'mitt'

/**
 * Whether the window is away: closed to the tray or the menu bar, or minimized, which the window's own events
 * report through setWindowAway. While it is away the page keeps its microphone off, a local speech synthesis
 * model is let go at the watchdog's next check after the reply under way has ended, and a finished job's
 * spoken report waits for the window, since the OS notification has told of the job already.
 */

/** Scheduler delivery follows the same native window events as microphone shutdown. */
export const presenceEvents = mitt<{ changed: boolean }>()
/** A window that has not shown yet counts as present: it is about to show. */
let away = false
let present: Array<() => void> = []

export const windowAway = (): boolean => away

export function setWindowAway(next: boolean): void {
  away = next
  presenceEvents.emit('changed', away)
  if (away) return
  const waiting = present
  present = []
  for (const resolve of waiting) resolve()
}

/** Resolves once the window is shown and not minimized, at once when it is. */
export function whenPresent(): Promise<void> {
  return away ? new Promise((resolve) => present.push(resolve)) : Promise.resolve()
}
