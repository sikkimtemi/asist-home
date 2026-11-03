import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TtsEngine } from '@shared/ipc'
import { errorText, readErrorText } from '@shared/i18n/error-text'
import { IRODORI_TTS_MODEL, IRODORI_TTS_VOICE_IDS, QWEN_TTS_MODELS, localTtsModel, qwenTtsLanguage } from '@shared/tts-models'
import { SPEECH_CPP_SERIES, WORKER_PROTOCOL } from '../src/main/services/speech-worker'
import { SPEECH_MODELS_OUTPUT, TEST_SPEECH_CATALOG } from './helpers/speech-catalog'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  downloadMissing: vi.fn(),
  settings: { uiLocale: 'en-US', ttsEngine: 'qwen3tts' as TtsEngine, qwenTtsSize: '0.6b' as '0.6b' | '1.7b' }
}))
vi.mock('../src/main/services/platform', () => import('./helpers/platform'))
vi.mock('../src/main/services/settings', () => ({ getSettings: () => mocks.settings }))
vi.mock('../src/main/services/pinned-download', () => ({ downloadMissing: mocks.downloadMissing }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app', getPath: () => '/user-data', on: vi.fn() } }))

const RATE = 24_000
function fakeChild() {
  const input: Array<Record<string, unknown>> = []
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    killed: false, exitCode: null as number | null, kill: vi.fn(), input
  })
  child.kill.mockImplementation(() => { child.killed = true; return true })
  child.stdin.on('data', (data) => {
    for (const line of String(data).split('\n').filter(Boolean)) input.push(JSON.parse(line))
  })
  return child
}
type Child = ReturnType<typeof fakeChild>
let children: Child[] = []
let local: typeof import('../src/main/services/local-tts')

const say = (child: Child, message: Record<string, unknown>): void => { child.stdout.write(`${JSON.stringify(message)}\n`) }
/** The `ready` of a 0.7 worker of a synthesis model on the GPU the capabilities chose, with the model information in part. */
const ready = (model: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'ready',
  protocol: WORKER_PROTOCOL,
  version: `${SPEECH_CPP_SERIES}.0`,
  model: { name: 'Qwen3-TTS-12Hz-0.6B-CustomVoice', task: 'synthesis', sample_rate: RATE, incremental: true, device: 'MTL0', threads: 0, ...model }
})
/** How the worker answers a line it cannot take, as speech.cpp words it. */
const workerError = (message: string, option: string | null = null): Record<string, unknown> => ({ code: 'invalid_argument', option, message })
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5))
/** A piece of loud tone, which the shaper passes on at once. */
function voiced(seconds = 0.48): string {
  const samples = new Int16Array(Math.round(seconds * RATE))
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(i / 10) * 8000)
  return Buffer.from(samples.buffer).toString('base64')
}
const REQUEST = { text: 'こんにちは。', voice: 'ono_anna', language: 'ja' } as const

beforeEach(async () => {
  const readFile = fs.readFileSync
  vi.spyOn(fs, 'readFileSync').mockImplementation((file, options) =>
    String(file) === path.join('/app', 'resources', 'speech', 'catalog.json') ? SPEECH_MODELS_OUTPUT : readFile(file, options))
  vi.resetModules()
  mocks.settings.ttsEngine = 'qwen3tts'
  mocks.settings.qwenTtsSize = '0.6b'
  vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  children = []
  mocks.spawn.mockReset().mockImplementation(() => {
    const child = fakeChild()
    children.push(child)
    // The worker reports ready as soon as something listens, as a loaded model would.
    setTimeout(() => say(child, ready()), 0)
    return child
  })
  local = await import('../src/main/services/local-tts')
})
afterEach(() => {
  local.stop()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const child of children) {
    child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy()
  }
})

async function collect(stream: AsyncIterable<Float32Array>): Promise<number> {
  let samples = 0
  for await (const piece of stream) samples += piece.length
  return samples
}

describe('Qwen3-TTS service', () => {
  it('yields the pieces of a request while they arrive and ends with the worker\'s end message', async () => {
    const stream = local.stream('qwen3tts', REQUEST)
    const first = stream.next()
    await settle()
    const child = children[0]
    const request = child.input.find((message) => message.text === REQUEST.text)!
    // Nothing else rides along: the worker refuses a member a request does not have, and a speed would change the voice.
    expect(request).toEqual({ type: 'synthesize', id: expect.any(String), text: REQUEST.text, voice: 'ono_anna', language: 'ja' })
    say(child, { type: 'chunk', id: request.id, seq: 0, pcm: voiced() })
    // The first piece is delivered before the sentence is finished.
    expect((await first).value!.length).toBeGreaterThan(0)
    say(child, { type: 'chunk', id: request.id, seq: 1, pcm: voiced() })
    say(child, { type: 'end', id: request.id, samples: 0 })
    expect(await collect(stream)).toBeGreaterThan(0)
    expect(child.input.some((message) => message.type === 'cancel')).toBe(false)
  })

  it('cancels the request in the worker as soon as the signal aborts, without waiting for the consumer', async () => {
    const controller = new AbortController()
    const stream = local.stream('qwen3tts', REQUEST, controller.signal)
    const first = stream.next()
    await settle()
    const child = children[0]
    const id = child.input.find((message) => message.text)!.id
    say(child, { type: 'chunk', id, seq: 0, pcm: voiced() })
    await first
    controller.abort()
    await settle()
    expect(child.input).toContainEqual({ type: 'cancel', id })
    await expect(stream.next()).rejects.toThrow()
  })

  it('cancels a request the consumer stops reading', async () => {
    const stream = local.stream('qwen3tts', REQUEST)
    const first = stream.next()
    await settle()
    const child = children[0]
    const id = child.input.find((message) => message.text)!.id
    say(child, { type: 'chunk', id, seq: 0, pcm: voiced() })
    await first
    await stream.return(undefined)
    expect(child.input).toContainEqual({ type: 'cancel', id })
  })

  it('fails every waiting request when the worker dies, and starts a new worker for the next request', async () => {
    const one = collect(local.stream('qwen3tts', REQUEST))
    const two = collect(local.stream('qwen3tts', { ...REQUEST, text: '次の文。' }))
    await settle()
    children[0].exitCode = 1
    children[0].emit('exit', 1)
    await expect(one).rejects.toThrow('exited')
    await expect(two).rejects.toThrow('exited')

    const again = local.stream('qwen3tts', REQUEST)
    const first = again.next()
    await settle()
    expect(children).toHaveLength(2)
    const id = children[1].input.find((message) => message.text)!.id
    say(children[1], { type: 'chunk', id, seq: 0, pcm: voiced() })
    expect((await first).done).toBe(false)
  })

  it('reports the worker\'s error for one request and keeps serving the others', async () => {
    const failing = collect(local.stream('qwen3tts', REQUEST))
    const healthy = collect(local.stream('qwen3tts', { ...REQUEST, text: '次の文。' }))
    await settle()
    const child = children[0]
    const [a, b] = child.input.filter((message) => message.text).map((message) => message.id)
    say(child, { type: 'error', id: a, error: { code: 'out_of_range', option: 'voice', message: 'unknown voice' } })
    say(child, { type: 'chunk', id: b, seq: 0, pcm: voiced() })
    say(child, { type: 'end', id: b, samples: 0 })
    await expect(failing).rejects.toThrow('out_of_range (voice): unknown voice')
    expect(await healthy).toBeGreaterThan(0)
  })

  it('generates a clip again when the model rambles, cancelling the rambling generation, and returns the first plausible one', async () => {
    const wav = local.synthesizeWav('qwen3tts', { ...REQUEST, text: 'うん。' })
    await settle()
    const child = children[0]
    const requests = (): Array<Record<string, unknown>> => child.input.filter((message) => message.text)
    // "うん。" may take 1.5 s; this generation is still going after 1.9 s.
    for (let seq = 0; seq < 4; seq++) say(child, { type: 'chunk', id: requests()[0].id, seq, pcm: voiced() })
    await settle()
    expect(child.input).toContainEqual({ type: 'cancel', id: requests()[0].id })
    expect(requests()).toHaveLength(2)
    say(child, { type: 'chunk', id: requests()[1].id, seq: 0, pcm: voiced() })
    say(child, { type: 'end', id: requests()[1].id, samples: 0 })
    const result = await wav
    expect(result.toString('ascii', 0, 4)).toBe('RIFF')
    // Only the second generation is in the file: 0.48 s of voice and the short tail at most.
    expect(result.readUInt32LE(40) / 2 / RATE).toBeLessThan(0.7)
  })

  it('lets a slow reading of a sentence full of digits finish, and still cuts one that rambles on past it', async () => {
    const text = '暗証番号は4桁で、8264です。'
    const reading = collect(local.stream('qwen3tts', { ...REQUEST, text }))
    await settle()
    const child = children[0]
    const first = child.input.find((message) => message.text === text)!.id
    // 6.2 s: a reading measured at 5.9 s lost its last digit to an allowance counted by characters alone.
    for (let seq = 0; seq < 13; seq++) say(child, { type: 'chunk', id: first, seq, pcm: voiced() })
    say(child, { type: 'end', id: first, samples: 0 })
    expect(await reading / RATE).toBeGreaterThan(6.2)
    expect(child.input).not.toContainEqual({ type: 'cancel', id: first })

    const rambling = collect(local.stream('qwen3tts', { ...REQUEST, text }))
    await settle()
    const second = child.input.filter((message) => message.text === text)[1].id
    for (let seq = 0; seq < 40; seq++) say(child, { type: 'chunk', id: second, seq, pcm: voiced() })
    expect(await rambling / RATE).toBeLessThan(8)
    expect(child.input).toContainEqual({ type: 'cancel', id: second })
  })

  it('gives up on a clip the model never reads plausibly instead of caching a bad one', async () => {
    const wav = local.synthesizeWav('qwen3tts', { ...REQUEST, text: 'うん。' })
    const outcome = wav.then(() => 'resolved', (error: Error) => error.message)
    const child = () => children[0]
    for (let attempt = 0; attempt < 6; attempt++) {
      await settle()
      const id = child().input.filter((message) => message.text)[attempt].id
      say(child(), { type: 'chunk', id, seq: 0, pcm: Buffer.alloc(RATE).toString('base64') })
      say(child(), { type: 'end', id, samples: 0 })
    }
    expect(await outcome).toContain('no plausible reading')
    expect(child().input.filter((message) => message.text)).toHaveLength(6)
  })

  it('does not start a worker while a file of the model is missing', async () => {
    vi.mocked(fs.existsSync).mockImplementation((file) => !String(file).endsWith(TEST_SPEECH_CATALOG[QWEN_TTS_MODELS['0.6b'].model].file))
    await expect(collect(local.stream('qwen3tts', REQUEST))).rejects.toThrow('not installed')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('runs the worker on the model file of the size the setting names and the GPU the capabilities chose', async () => {
    await expect(local.ensureWorker('qwen3tts')).resolves.toBe(true)
    const [command, args] = mocks.spawn.mock.calls[0] as [string, string[]]
    expect(path.basename(command)).toMatch(/^speech(\.exe)?$/)
    expect(args.map((arg) => (arg.endsWith('.gguf') ? path.basename(arg) : arg))).toEqual([
      'worker', TEST_SPEECH_CATALOG[QWEN_TTS_MODELS['0.6b'].model].file, '--device', 'MTL0'
    ])
  })

  it('starts the worker again on the model of the other size when the size changes', async () => {
    await expect(local.ensureWorker('qwen3tts')).resolves.toBe(true)
    mocks.settings.qwenTtsSize = '1.7b'
    expect(local.available('qwen3tts')).toBe(false)
    await expect(local.ensureWorker('qwen3tts')).resolves.toBe(true)
    expect(children[0].kill).toHaveBeenCalled()
    expect(path.basename((mocks.spawn.mock.calls[1] as [string, string[]])[1][1])).toBe(TEST_SPEECH_CATALOG[QWEN_TTS_MODELS['1.7b'].model].file)
  })
})

describe('how long the worker has had nothing to do', () => {
  afterEach(() => vi.useRealTimers())

  it('counts from when it became ready, is busy while it reads, and counts again from the end of the reading', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000)
    expect(local.idleSince()).toBe(-Infinity)
    const starting = local.ensureWorker('qwen3tts')
    expect(local.idleSince()).toBeNull()
    await starting
    expect(local.idleSince()).toBe(1_000)

    vi.setSystemTime(60_000)
    const stream = local.stream('qwen3tts', REQUEST)
    const first = stream.next()
    await settle()
    expect(local.idleSince()).toBeNull()
    const child = children[0]
    const id = child.input.find((message) => message.text)!.id
    say(child, { type: 'chunk', id, seq: 0, pcm: voiced() })
    await first
    vi.setSystemTime(90_000)
    say(child, { type: 'end', id, samples: 0 })
    await collect(stream)
    expect(local.idleSince()).toBe(90_000)
  })
})

describe('a sentence the worker fails after its first piece', () => {
  /** Starts a sentence, delivers its first piece, applies the failure and returns the error the rest of the sentence ends with. */
  async function failedAfterFirstPiece(fail: (child: Child, id: string) => void | Promise<void>): Promise<Error> {
    const stream = local.stream('qwen3tts', REQUEST)
    const first = stream.next()
    await settle()
    const child = children[0]
    const id = child.input.find((message) => message.text)!.id as string
    say(child, { type: 'chunk', id, seq: 0, pcm: voiced() })
    await first
    await fail(child, id)
    return stream.next().then(() => { throw new Error('the sentence went on') }, (error: Error) => error)
  }
  const engine = localTtsModel('qwen3tts', '0.6b', TEST_SPEECH_CATALOG).label

  // The conversation shows this error on its error line, in the language of the interface.
  it.each([
    ['the worker exits', (child: Child) => { child.exitCode = 1; child.emit('exit', 1) }],
    ['the worker reports an error for the sentence', (child: Child, id: string) => say(child, { type: 'error', id, error: { code: 'internal', option: null, message: 'decoder failed' } })],
    ['the worker reports an error without its object', (child: Child, id: string) => say(child, { type: 'error', id })],
    ['the worker writes a line that is not a message', (child: Child) => { child.stdout.write('ggml_metal_init: loaded kernel\n') }]
  ])('ends it with an error the screen words in its own language when %s', async (_case, fail) => {
    const error = await failedAfterFirstPiece(fail)
    expect(readErrorText(error.message, 'ja-JP')).not.toBeNull()
    expect(error.name).not.toBe('AbortError')
  })

  it('ends it with an error of the app\'s own, not an English sentence as its detail, when the worker goes silent', async () => {
    vi.useFakeTimers()
    try {
      const stream = local.stream('qwen3tts', REQUEST)
      const first = stream.next()
      await vi.advanceTimersByTimeAsync(10)
      const child = children[0]
      const id = child.input.find((message) => message.text)!.id
      say(child, { type: 'chunk', id, seq: 0, pcm: voiced() })
      await first
      const rest = stream.next().then(() => { throw new Error('the sentence went on') }, (error: Error) => error)
      await vi.advanceTimersByTimeAsync(60_000)
      expect((await rest).message).toBe(errorText('voice.speech.engineNoResponse', { engine }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops a worker that never answers a sentence the consumer stopped reading, so that the next sentence starts a new one', async () => {
    vi.useFakeTimers()
    try {
      const stream = local.stream('qwen3tts', REQUEST)
      const first = stream.next()
      await vi.advanceTimersByTimeAsync(10)
      const child = children[0]
      const id = child.input.find((message) => message.text)!.id
      say(child, { type: 'chunk', id, seq: 0, pcm: voiced() })
      await first
      await stream.return(undefined)
      expect(child.input).toContainEqual({ type: 'cancel', id })
      // The worker hangs and never answers the cancel.
      await vi.advanceTimersByTimeAsync(29_000)
      expect(child.kill).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(child.kill).toHaveBeenCalled()
      expect(local.available('qwen3tts')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ends it as stopped, which is no failure, when the worker is stopped for another engine', async () => {
    const error = await failedAfterFirstPiece(() => local.stop())
    expect(error.name).toBe('AbortError')
  })
})

describe('the start of a worker', () => {
  /** Starts the engine's worker with the given first line and resolves to whether it became ready. */
  async function startWith(first: Record<string, unknown> | string, engine: 'qwen3tts' | 'irodori' = 'qwen3tts'): Promise<boolean> {
    mocks.spawn.mockImplementation(() => {
      const child = fakeChild()
      children.push(child)
      setTimeout(() => (typeof first === 'string' ? child.stdout.write(`${first}\n`) : say(child, first)), 0)
      return child
    })
    return local.ensureWorker(engine)
  }

  it('takes any release of the series the client is written for', async () => {
    await expect(startWith({ ...ready(), version: `${SPEECH_CPP_SERIES}.9` })).resolves.toBe(true)
  })

  it.each([
    ['another protocol', { ...ready(), protocol: 1 }],
    ['the previous worker protocol', { ...ready(), protocol: 3 }],
    ['a release of an earlier series', { ...ready(), version: '0.6.2' }],
    ['a model for another task', ready({ task: 'recognition', sample_rate: 16_000 })],
    ['a model on another device than the one asked for', ready({ device: 'CPU' })],
    ['no sample rate', ready({ sample_rate: undefined })],
    ['fatal instead of ready', { type: 'fatal', error: { code: 'model_file', option: null, message: 'no speech.layout' } }],
    ['a line that is not JSON', 'ASIST_JSON:{"type":"ready"}']
  ])('starts nothing to read with when the worker reports %s', async (_case, first) => {
    await expect(startWith(first)).resolves.toBe(false)
    expect(children[0].kill).toHaveBeenCalled()
    expect(local.available('qwen3tts')).toBe(false)
  })

  it('reads the rate of the audio from the model information', async () => {
    await startWith(ready({ name: 'Irodori-TTS-848M-MF-v4.1', sample_rate: 48_000, incremental: false }), 'irodori')
    const wav = local.synthesizeWav('irodori', { text: 'うん。', voice: 'calm-young-woman', language: 'ja' })
    await settle()
    const id = children[0].input.find((message) => message.text)!.id
    say(children[0], { type: 'chunk', id, seq: 0, pcm: voiced() })
    say(children[0], { type: 'end', id, seed: 7, samples: 0, stop: 'complete' })
    expect((await wav).readUInt32LE(24)).toBe(48_000)
  })
})

describe('the answers of the worker', () => {
  /** Starts a sentence and resolves to its worker, its request id and the outcome of reading it to the end. */
  async function reading(): Promise<{ child: Child; id: string; outcome: Promise<number | Error> }> {
    const outcome = collect(local.stream('qwen3tts', REQUEST)).catch((error: Error) => error)
    await settle()
    const child = children[0]
    return { child, id: child.input.find((message) => message.text)!.id as string, outcome }
  }

  it('keeps a sentence the worker reports progress on, however long it passes no audio', async () => {
    vi.useFakeTimers()
    try {
      const outcome = collect(local.stream('qwen3tts', REQUEST)).catch((error: Error) => error)
      await vi.advanceTimersByTimeAsync(10)
      const child = children[0]
      const id = child.input.find((message) => message.text)!.id
      for (let second = 1; second <= 90; second++) {
        say(child, { type: 'progress', id, done: second / 100 })
        await vi.advanceTimersByTimeAsync(1_000)
      }
      say(child, { type: 'chunk', id, seq: 0, pcm: voiced() })
      say(child, { type: 'end', id, seed: 7, samples: 0, stop: 'complete' })
      expect(await outcome).toBeGreaterThan(0)
      expect(child.kill).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the worker on an error that names no request, which answers a line ASIST got wrong', async () => {
    const { child, outcome } = await reading()
    say(child, { type: 'error', error: workerError('a member the type does not have', 'speed') })
    expect(readErrorText(((await outcome) as Error).message, 'ja-JP')).not.toBeNull()
    expect(child.kill).toHaveBeenCalled()
  })

  it('drops the audio of a sentence it cancelled until the worker answers the cancel, and then takes nothing more for it', async () => {
    const stream = local.stream('qwen3tts', REQUEST)
    const first = stream.next()
    await settle()
    const child = children[0]
    const id = child.input.find((message) => message.text)!.id
    say(child, { type: 'chunk', id, seq: 0, pcm: voiced() })
    await first
    await stream.return(undefined)
    // The worker was making the next chunk when the cancel arrived.
    say(child, { type: 'chunk', id, seq: 1, pcm: voiced() })
    say(child, { type: 'cancelled', id })
    await settle()
    expect(local.available('qwen3tts')).toBe(true)
    say(child, { type: 'chunk', id, seq: 2, pcm: voiced() })
    await settle()
    expect(child.kill).toHaveBeenCalled()
  })

  it('stops the worker when it cancels a sentence ASIST did not cancel', async () => {
    const { child, id, outcome } = await reading()
    say(child, { type: 'cancelled', id })
    expect(readErrorText(((await outcome) as Error).message, 'ja-JP')).not.toBeNull()
    expect(child.kill).toHaveBeenCalled()
  })

  it('passes over a message of a type the protocol may add', async () => {
    const { child, id, outcome } = await reading()
    say(child, { type: 'stats', id, tokens: 12 })
    say(child, { type: 'chunk', id, seq: 0, pcm: voiced() })
    say(child, { type: 'end', id, seed: 7, samples: 0, stop: 'complete' })
    expect(await outcome).toBeGreaterThan(0)
  })
})

describe('Irodori-TTS service', () => {
  it('runs the worker on the model file, every voice the app ships and the GPU the capabilities chose', async () => {
    await expect(local.ensureWorker('irodori')).resolves.toBe(true)
    const [command, args] = mocks.spawn.mock.calls[0] as [string, string[]]
    expect(path.basename(command)).toMatch(/^speech(\.exe)?$/)
    expect([args[0], path.basename(args[1])]).toEqual(['worker', TEST_SPEECH_CATALOG[IRODORI_TTS_MODEL.model].file])
    const voices = args.flatMap((arg, index) => (args[index - 1] === '--add-voice' ? [arg] : []))
    expect(voices.map((voice) => voice.split('=')[0])).toEqual([...IRODORI_TTS_VOICE_IDS])
    for (const voice of voices) {
      const [name, file] = voice.split('=')
      expect(file).toBe(path.join('/app', 'resources', 'irodori-voices', `${name}.voice.gguf`))
    }
    expect(args.slice(-2)).toEqual(['--device', 'MTL0'])
  })

  it('replaces the Qwen3-TTS worker when Irodori-TTS is chosen, since one worker runs one model', async () => {
    await expect(local.ensureWorker('qwen3tts')).resolves.toBe(true)
    expect(local.available('irodori')).toBe(false)
    await expect(local.ensureWorker('irodori')).resolves.toBe(true)
    expect(children[0].kill).toHaveBeenCalled()
    expect(local.available('irodori')).toBe(true)
    expect(local.available('qwen3tts')).toBe(false)
  })

  it('lets a reading run as long as the model made it, since Irodori-TTS fixes the length before it speaks', async () => {
    const reading = collect(local.stream('irodori', { text: 'うん。', voice: 'calm-young-woman', language: 'ja' }))
    await settle()
    const child = children[0]
    const id = child.input.find((message) => message.text)!.id
    // 3.8 s, past the 1.5 s Qwen3-TTS is allowed for the same text.
    for (let seq = 0; seq < 8; seq++) say(child, { type: 'chunk', id, seq, pcm: voiced() })
    say(child, { type: 'end', id, samples: 0 })
    expect(await reading / RATE).toBeGreaterThan(3.5)
    expect(child.input).not.toContainEqual({ type: 'cancel', id })
  })
})

describe('preparing a local model', () => {
  /** The model files that are there, by name. */
  let installed: Set<string>
  /** Ends the download of the prepared model's files, which takes minutes in the app. */
  let finishDownload: () => void

  const install = (files: ReadonlyArray<{ file: string }>): void => {
    for (const { file } of files) installed.add(file)
  }

  beforeEach(() => {
    installed = new Set()
    vi.mocked(fs.existsSync).mockImplementation((file) => !String(file).endsWith('.gguf') || installed.has(path.basename(String(file))))
    mocks.downloadMissing.mockReset().mockImplementation((files: Array<{ file: { file: string } }>, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        finishDownload = () => {
          install(files.map((entry) => entry.file))
          resolve()
        }
      }))
  })

  it('starts the worker on the files it fetched while the settings still select that model', async () => {
    const preparation = local.prepare('qwen3tts', () => {})
    await settle()
    expect(mocks.spawn).not.toHaveBeenCalled()
    finishDownload()
    expect((await preparation).ok).toBe(true)
    expect(local.available('qwen3tts')).toBe(true)
  })

  it('leaves the worker of the engine chosen while the files downloaded running, and starts none of its own', async () => {
    install(localTtsModel('irodori', '0.6b', TEST_SPEECH_CATALOG).files)
    const preparation = local.prepare('qwen3tts', () => {})
    await settle()
    // The user picks Irodori-TTS on the voice page, and the change of the setting starts it.
    mocks.settings.ttsEngine = 'irodori'
    await expect(local.ensureWorker('irodori')).resolves.toBe(true)
    finishDownload()
    expect((await preparation).ok).toBe(true)
    expect(children).toHaveLength(1)
    expect(local.available('irodori')).toBe(true)
  })

  it('starts no worker when the user chose an engine that needs none while the files downloaded', async () => {
    const preparation = local.prepare('qwen3tts', () => {})
    await settle()
    mocks.settings.ttsEngine = 'voicevox'
    finishDownload()
    expect((await preparation).ok).toBe(true)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('reports the files of a size the user turned away from as prepared rather than as a model that failed to start', async () => {
    const preparation = local.prepare('qwen3tts', () => {})
    await settle()
    mocks.settings.qwenTtsSize = '1.7b'
    finishDownload()
    expect((await preparation).ok).toBe(true)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('keeps the worker of the engine chosen while the files downloaded when the preparation is cancelled', async () => {
    install(localTtsModel('irodori', '0.6b', TEST_SPEECH_CATALOG).files)
    const preparation = local.prepare('qwen3tts', () => {})
    await settle()
    mocks.settings.ttsEngine = 'irodori'
    await local.ensureWorker('irodori')
    expect(local.cancelPreparation()).toBe(true)
    expect((await preparation).ok).toBe(false)
    expect(children[0].kill).not.toHaveBeenCalled()
    expect(local.available('irodori')).toBe(true)
  })
})

describe('qwenTtsLanguage', () => {
  it('names the language of a locale by its language subtag, and knows which locales the model cannot speak', () => {
    expect(qwenTtsLanguage('ja-JP')).toBe('ja')
    expect(qwenTtsLanguage('pt-BR')).toBe('pt')
    expect(qwenTtsLanguage('es-419')).toBe('es')
    expect(qwenTtsLanguage('hi-IN')).toBeNull()
    expect(qwenTtsLanguage('id-ID')).toBeNull()
  })
})
