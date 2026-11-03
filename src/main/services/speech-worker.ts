import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import readline from 'node:readline'
import { app } from 'electron'
import { errorText } from '@shared/i18n/error-text'
import { watchForAsistEnd } from './asist-end-watcher'
import { childEnv } from './child-env'
import { platformCapabilities } from './platform'
import { SPEECH_CPP_SERIES, WORKER_PROTOCOL } from '@shared/speech-worker-protocol'

export { SPEECH_CPP_SERIES, WORKER_PROTOCOL } from '@shared/speech-worker-protocol'

/**
 * The processes the local speech runs in, and the client of speech.cpp's worker protocol 4: one JSON object per
 * line on stdin and on stdout, and nothing else on stdout; the first message is `ready`, with the model's
 * information, or `fatal`; then each request gets the answers that name it by its id and exactly one terminal
 * message, `end`, `error` or `cancelled`, and nothing after it; stderr goes to the app log under the worker's name.
 * The speech synthesis and the speech recognition each run a worker of their own on this client. Quitting the app
 * stops every one of them. A worker reads its requests from stdin and ends by itself once ASIST is gone and the pipe
 * closes, however ASIST ended; a process that reads nothing from ASIST is started through spawnUnattended.
 */

/** The series of a release version such as `0.7.0`, or null for anything else. */
const seriesOf = (version: unknown): string | null =>
  typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version.slice(0, version.lastIndexOf('.')) : null

/**
 * Loading a model, warming it up and compiling its GPU kernels comes before `ready`. The first start of the
 * Qwen3-TTS worker after a GPU driver update compiled its Vulkan shaders for 12.6 s on an RTX 2080 (2026-09-29).
 */
const WORKER_READY_TIMEOUT_MS = 180_000

const children = new Set<ChildProcess>()
let quitHookRegistered = false

/** Stops `child` when the app quits, unless it has ended by then. */
export function stopOnQuit(child: ChildProcess): void {
  children.add(child)
  child.once('exit', () => children.delete(child))
  if (quitHookRegistered) return
  quitHookRegistered = true
  app.on('will-quit', () => {
    for (const running of [...children]) running.kill('SIGTERM')
  })
}

/** A message of the worker: a JSON object with a string `type`. */
export type WorkerMessage = Record<string, unknown> & { type: string }

/**
 * The `error` member of `error` and `fatal` as speech's command line writes a failure, `code (option): message`.
 * Throws on a member that is not an error object of the protocol.
 */
export function describeWorkerError(error: unknown): string {
  const { code, option, message } = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>
  if (typeof code !== 'string' || typeof message !== 'string') throw new Error(`the worker sent ${JSON.stringify(error)} where an error object belongs`)
  return `${code}${typeof option === 'string' ? ` (${option})` : ''}: ${message}`
}

/** What a model does, as its information names it: a worker serves the requests of its model's task alone. */
export type WorkerTask = 'synthesis' | 'recognition'

export interface WorkerOptions {
  task: WorkerTask
  /** The device the model is loaded on, which the worker is given and its `ready` must name. */
  device: string
  /**
   * How long the worker may send nothing while it has a request in flight, a cancelled one included, before it is
   * taken to be hung. A hung worker is stopped, its requests in flight fail with `error()`, and `onFailure` is called
   * with that error. A request whose caller stopped waiting is still awaited, so that a worker that never answers it
   * is found out and started again rather than left holding every later request back.
   */
  silence: { ms: number; error: () => Error }
  /**
   * The worker failed to load, broke the protocol, crashed, exited on its own or went silent. The owner may stop it
   * here with the error its requests in flight are to fail with; it stops itself with `error` otherwise. A worker that
   * went silent has stopped already, its requests failed with the error of `silence`. It is not called after
   * `stop()`.
   */
  onFailure: (error: Error) => void
}

/**
 * What a request makes of the answers to it. A handler that throws on an answer the request cannot have fails the
 * worker, as that answer is the worker's defect, and the request with it.
 */
export interface WorkerRequest {
  /** Each `chunk` before the terminal message. A request without it takes none. */
  partway?: (message: WorkerMessage) => void
  /** The request's `end`. */
  end: (message: WorkerMessage) => void
  /** The worker's `error` for the request, as speech's command line writes a failure. */
  error: (reason: string) => void
  /** The worker stopped or failed before it answered the request, for `reason`. */
  abandoned: (reason: Error) => void
}

/** A request the worker has not answered yet. A cancelled one stays until its terminal message, and its answers are dropped. */
interface InFlight {
  answers: WorkerRequest
  cancelled: boolean
}

/** The messages that answer a request. The protocol may gain messages without being raised, so any other is passed over. */
const ANSWERS: ReadonlySet<string> = new Set(['chunk', 'progress', 'end', 'error', 'cancelled'])

/** One running worker. `ready` settles once: true on the worker's `ready` message, false when it fails or is stopped first. */
export class SpeechWorker {
  readonly ready: Promise<boolean>
  /** The rate of the audio the model makes or recognizes, from the model information of `ready`; 0 until then. */
  sampleRate = 0
  private stopped = false
  private settleReady!: (ready: boolean) => void
  private isReady = false
  private readonly inFlight = new Map<string, InFlight>()
  private silenceTimer: NodeJS.Timeout | null = null

  constructor(
    readonly child: ChildProcessWithoutNullStreams,
    private readonly logName: string,
    private readonly options: WorkerOptions
  ) {
    this.ready = new Promise<boolean>((resolve) => { this.settleReady = resolve })
    const timeout = setTimeout(() => this.fail(new Error(`${logName} worker did not become ready`)), WORKER_READY_TIMEOUT_MS)
    void this.ready.then(() => clearTimeout(timeout))
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line))
    // The protocol carries every failure as a message on stdout, which fail() logs as an error. stderr is the
    // worker's own log, such as the device the model loaded on and its `ready`, so it goes to the app log as
    // information.
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      if (line.trim()) console.log(`${logName}: ${line}`)
    })
    child.on('error', (error) => this.fail(error))
    child.on('exit', (code) => this.fail(new Error(`${logName} worker exited (${code ?? 'signal'})`)))
    // A write between the worker's death and its exit event fails with EPIPE, which becomes an uncaught
    // exception unless the stream has a listener.
    child.stdin.on('error', (error) => this.fail(error))
  }

  get alive(): boolean {
    return !this.stopped && this.child.exitCode === null && !this.child.killed
  }

  /** The requests the worker has not answered yet, cancelled ones included. */
  get pending(): number {
    return this.inFlight.size
  }

  /** Writes the lines of a request, the last of which makes it complete, and hands every answer under `id` to `answers`. */
  request(id: string, lines: ReadonlyArray<Record<string, unknown>>, answers: WorkerRequest): void {
    if (this.stopped) throw new Error(`${this.logName} worker has stopped and takes no request`)
    // The worker answers a request under an id already in flight with an error that names no request.
    if (this.inFlight.has(id)) throw new Error(`${this.logName} worker has a request ${id} in flight already`)
    this.inFlight.set(id, { answers, cancelled: false })
    for (const line of lines) this.send(line)
    this.armSilence()
  }

  /** Cancels a request in flight. One that has had its terminal message, or was cancelled already, is left alone. */
  cancel(id: string): void {
    const request = this.inFlight.get(id)
    if (!request || request.cancelled || this.stopped) return
    request.cancelled = true
    this.send({ type: 'cancel', id })
    this.armSilence()
  }

  /** Stops the worker and ends every request in flight that was not cancelled with `reason`. */
  stop(reason: Error): void {
    if (this.stopped) return
    this.stopped = true
    this.settleReady(false)
    if (this.child.exitCode === null && !this.child.killed) this.child.kill('SIGTERM')
    const abandoned = [...this.inFlight.values()]
    this.inFlight.clear()
    this.armSilence()
    for (const request of abandoned) if (!request.cancelled) request.answers.abandoned(reason)
  }

  /** Starts the wait for the worker's next message over, while a request is in flight; with none, nothing is awaited. */
  private armSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer)
    this.silenceTimer = this.inFlight.size === 0 ? null : setTimeout(() => this.wentSilent(), this.options.silence.ms)
  }

  private wentSilent(): void {
    if (this.stopped) return
    const error = this.options.silence.error()
    console.error(`${this.logName}: sent nothing for ${this.options.silence.ms / 1000} s with ${this.inFlight.size} requests in flight`)
    this.stop(error)
    this.options.onFailure(error)
  }

  private send(message: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private fail(error: Error): void {
    if (this.stopped) return
    console.error(`${this.logName}: ${error.message}`)
    this.options.onFailure(error)
    this.stop(error)
  }

  private handleLine(line: string): void {
    if (this.stopped) return
    try {
      const message = this.read(line)
      if (message.type === 'ready') {
        this.isReady = true
        this.settleReady(true)
        return
      }
      if (!ANSWERS.has(message.type)) return
      this.answer(message)
    } catch (error) {
      this.fail(error as Error)
      return
    }
    this.armSilence()
  }

  /** The message of a line, after the checks of the protocol that concern no request. Throws on a line that breaks it. */
  private read(line: string): WorkerMessage {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      throw new Error(`${this.logName} worker wrote a line on stdout that is not JSON: ${line.slice(0, 200)}`)
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message) || typeof (message as { type?: unknown }).type !== 'string') {
      throw new Error(`${this.logName} worker wrote a line on stdout that is not a message: ${line.slice(0, 200)}`)
    }
    const read = message as WorkerMessage
    if (read.type === 'fatal') throw new Error(`${this.logName} worker could not start: ${describeWorkerError(read.error)}`)
    if (read.type === 'ready') {
      if (this.isReady) throw new Error(`${this.logName} worker reported ready a second time`)
      this.sampleRate = this.checkReady(read)
    }
    // The worker answers a line it cannot place with an error without an id. ASIST writes every line it
    // sends, so this is ASIST's own defect.
    if (read.type === 'error' && typeof read.id !== 'string') throw new Error(`${this.logName} worker could not take a line ASIST sent: ${describeWorkerError(read.error)}`)
    return read
  }

  /**
   * Hands a message to the request it answers. An answer for no request in flight, a `cancelled` ASIST did not ask
   * for, or a `chunk` for a request that takes none is the worker's defect, and throws.
   */
  private answer(message: WorkerMessage): void {
    const id = typeof message.id === 'string' ? message.id : null
    const request = id === null ? undefined : this.inFlight.get(id)
    if (id === null || !request) throw new Error(`${this.logName} worker sent ${message.type} for ${String(message.id)}, which no request in flight has`)
    if (message.type === 'progress') return
    if (message.type === 'chunk') {
      if (request.cancelled) return
      if (!request.answers.partway) throw new Error(`${this.logName} worker sent ${message.type} for ${id}, which is answered with its end alone`)
      request.answers.partway(message)
      return
    }
    if (message.type === 'cancelled' && !request.cancelled) throw new Error(`${this.logName} worker cancelled ${id}, which ASIST did not cancel`)
    // The request stays in flight until it has taken its terminal message, so that one it cannot have fails it
    // with the others.
    if (!request.cancelled && message.type === 'end') request.answers.end(message)
    else if (!request.cancelled && message.type === 'error') request.answers.error(describeWorkerError(message.error))
    this.inFlight.delete(id)
  }

  /** Checks that `ready` comes from a worker this client can speak to, running the model as asked, and returns the model's sample rate. */
  private checkReady(ready: WorkerMessage): number {
    const name = this.logName
    if (ready.protocol !== WORKER_PROTOCOL) throw new Error(`${name} worker speaks protocol ${JSON.stringify(ready.protocol)}, and ASIST speaks protocol ${WORKER_PROTOCOL}`)
    if (seriesOf(ready.version) !== SPEECH_CPP_SERIES) throw new Error(`${name} worker is speech.cpp ${JSON.stringify(ready.version)}, and ASIST is written for ${SPEECH_CPP_SERIES}.x`)
    const model = (typeof ready.model === 'object' && ready.model !== null ? ready.model : {}) as Record<string, unknown>
    if (model.task !== this.options.task) throw new Error(`${name} worker runs a model for ${JSON.stringify(model.task)}, not for ${this.options.task}`)
    if (model.device !== this.options.device) throw new Error(`${name} worker runs on ${JSON.stringify(model.device)}, not on ${this.options.device}`)
    if (typeof model.sample_rate !== 'number' || model.sample_rate <= 0) throw new Error(`${name} worker gives no sample rate in its model information`)
    return model.sample_rate
  }
}

/**
 * Starts a speech process that reads nothing from ASIST, the engine of another app such as VOICEVOX, so that it
 * ends with ASIST however ASIST ends. The VOICEVOX and AivisSpeech engines, started by a Node process that was then
 * killed, ran on with launchd as their parent on an Apple M5, while the workers that read stdin ended (2026-10-05).
 * On macOS it leads a process group of its own that a watcher stops when ASIST ends, and it is not started when
 * the watcher cannot be, with `engine` named in the error. On Windows a child ended with a killed ASIST already, in
 * the job object libuv puts it into (RTX 2080, 2026-10-05).
 */
export function spawnUnattended(command: string, args: string[], options: SpawnOptions & { env: NodeJS.ProcessEnv }, engine: string): ChildProcess {
  const macos = platformCapabilities().os === 'macos'
  const child = spawn(command, args, { ...options, detached: macos, windowsHide: true })
  stopOnQuit(child)
  if (macos && child.pid !== undefined && !watchForAsistEnd(child, options.env, 'asist-speech-watcher')) {
    child.kill('SIGKILL')
    throw new Error(errorText('voice.speech.watcherUnavailable', { engine }))
  }
  return child
}

/** Starts `speech worker` at `command` on the model file, with the further arguments `args` and the device of the options. */
export function startSpeechWorker(command: string, model: string, args: string[], logName: string, options: WorkerOptions): SpeechWorker {
  const child = spawn(command, ['worker', model, ...args, '--device', options.device], { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv(), windowsHide: true })
  stopOnQuit(child)
  return new SpeechWorker(child, logName, options)
}
