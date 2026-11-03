/**
 * The devices the local speech can run on, as `speech devices --json` lists them, and the choice of the one
 * to run on, which every worker is then started on by its ggml name.
 */

/** One device of the list. `kind` is ggml's: a discrete GPU, an integrated one, or the CPU. */
export interface SpeechDevice {
  name: string
  description: string
  kind: 'gpu' | 'igpu' | 'cpu'
  memoryTotal: number
}

/**
 * The devices in the output of `speech devices --json`, one JSON object on stdout alone, or null when it holds
 * no list that reads.
 */
export function parseSpeechDevices(output: string): SpeechDevice[] | null {
  let message: unknown
  try {
    message = JSON.parse(output)
  } catch {
    return null
  }
  const devices = (message as { devices?: unknown } | null)?.devices
  if (!Array.isArray(devices)) return null
  const read: SpeechDevice[] = []
  for (const device of devices as Array<Record<string, unknown>>) {
    const { name, description, kind, memory_total: memoryTotal } = device
    if (typeof name !== 'string' || typeof description !== 'string' || typeof memoryTotal !== 'number') return null
    if (kind !== 'gpu' && kind !== 'igpu' && kind !== 'cpu') return null
    read.push({ name, description, kind, memoryTotal })
  }
  return read
}

/** Chooses the largest discrete GPU, or the largest integrated GPU when allowed and no discrete GPU exists. */
export function chooseSpeechDevice(devices: readonly SpeechDevice[], allowIntegrated = false): { device: string; memoryGb: number; memoryType: 'shared' | 'dedicated' } | null {
  const discrete = devices.filter((device) => device.kind === 'gpu')
  const candidates = discrete.length > 0 ? discrete : allowIntegrated ? devices.filter((device) => device.kind === 'igpu') : []
  if (candidates.length === 0) return null
  const best = candidates.reduce((a, b) => (b.memoryTotal > a.memoryTotal ? b : a))
  return { device: best.name, memoryGb: Math.round(best.memoryTotal / 1024 ** 3), memoryType: best.kind === 'igpu' ? 'shared' : 'dedicated' }
}
