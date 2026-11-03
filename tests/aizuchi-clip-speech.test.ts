import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startRecognizer } from '../scripts/aizuchi-clips/speech.mjs'
import { SPEECH_MODELS_OUTPUT } from './helpers/speech-catalog'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
// The script runs the bundled speech and the model files a developer has prepared, which a test machine lacks.
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  existsSync: () => true,
  readFileSync: () => SPEECH_MODELS_OUTPUT
}))

function fakeWorker() {
  const input: Array<Record<string, unknown>> = []
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), kill: vi.fn(), input })
  child.stdin.on('data', (data) => {
    for (const line of String(data).split('\n').filter(Boolean)) input.push(JSON.parse(line))
  })
  return child
}
type Worker = ReturnType<typeof fakeWorker>
const say = (child: Worker, message: Record<string, unknown>): void => { child.stdout.write(`${JSON.stringify(message)}\n`) }

let worker: Worker
beforeEach(() => {
  worker = fakeWorker()
  mocks.spawn.mockReset().mockImplementation(() => {
    setTimeout(() => say(worker, { type: 'ready', protocol: 4, version: '0.10.1', model: { task: 'recognition', sample_rate: 16_000 } }), 0)
    return worker
  })
})

describe('the speech recognition the aizuchi clips and voice samples are checked with', () => {
  it('sends the samples and the language to the worker and returns the text of its end', async () => {
    const recognizer = await startRecognizer()
    const heard = recognizer.recognize(new Float32Array(2400), 'en')
    await vi.waitFor(() => expect(worker.input.some((message) => message.type === 'transcribe')).toBe(true))
    expect(worker.input.at(-1)).toEqual({ type: 'transcribe', id: expect.any(String), sample_rate: 24_000, language: 'en' })
    say(worker, { type: 'end', id: worker.input.at(-1)!.id, text: ' Yes. ', stop: 'complete' })
    await expect(heard).resolves.toBe('Yes.')
  })

  it('fails a recognition in flight, and every later one, when the worker exits, so that the script reaches its cleanup', async () => {
    const recognizer = await startRecognizer()
    const heard = recognizer.recognize(new Float32Array(2400))
    await vi.waitFor(() => expect(worker.input).toHaveLength(2))
    worker.emit('exit', 1)
    await expect(heard).rejects.toThrow('exited')
    await expect(recognizer.recognize(new Float32Array(2400))).rejects.toThrow('exited')
  })

  it('fails a recognition in flight when the pipe to the worker breaks', async () => {
    const recognizer = await startRecognizer()
    const heard = recognizer.recognize(new Float32Array(2400))
    await vi.waitFor(() => expect(worker.input).toHaveLength(2))
    worker.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    await expect(heard).rejects.toThrow('EPIPE')
  })
})
