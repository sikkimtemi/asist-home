import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ASR_MODEL_SPECS, asrLanguage, type ResolvedAsrModel } from '@shared/asr-models'
import type { ConversationLocale } from '@shared/conversation-locale'

/**
 * The local speech recognition through ASIST's own worker client and the bundled speech (node
 * scripts/prepare-resources.mjs dev), on model files laid out as the app lays them out under
 * <folder>/speech-models, and on recordings whose texts the official implementation of each model wrote:
 *
 *   SPEECH_LIVE_USER_DATA=<folder> ASR_LIVE_CLIPS=<clips> npx vitest run tests/local-asr-live.test.ts --silent=false --reporter=verbose
 *
 * <clips> holds WAVE files, 16-bit PCM or 32-bit float at 16 kHz, and requests.json, a list of
 * { model, input, kind, language, official } where `model` is the name of a model file's model information
 * (Qwen3-ASR-1.7B, parakeet-tdt_ctc-0.6b-ja) and `kind` "forced" names the text the official implementation wrote
 * with the language forced; the FastConformer models, which take no language, have only such rows. A model with no
 * file or no row is skipped. It prints how long each worker took to become ready, each recording to its text, and
 * on a Mac the worker's physical footprint after the first 20 s of the longest recording in a language the model
 * recognizes, the longest utterance ASIST sends.
 */

const userData = process.env.SPEECH_LIVE_USER_DATA
const clips = process.env.ASR_LIVE_CLIPS

const mocks = vi.hoisted(() => ({
  settings: { uiLocale: 'ja-JP', conversationLocale: 'ja-JP' as ConversationLocale }
}))
vi.mock('../src/main/services/platform', () => import('./helpers/platform'))
vi.mock('../src/main/services/settings', () => ({ getSettings: () => mocks.settings }))
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => path.resolve('.'), getPath: () => process.env.SPEECH_LIVE_USER_DATA, on: vi.fn() }
}))

/** The mono samples of a 16 kHz WAVE file of 16-bit PCM or 32-bit float. */
function readWave(file: string): Float32Array {
  const wav = fs.readFileSync(file)
  let offset = 12
  let format = 0
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4)
    const size = wav.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      format = wav.readUInt16LE(offset + 8)
      if (wav.readUInt16LE(offset + 10) !== 1 || wav.readUInt32LE(offset + 12) !== 16_000) throw new Error(`${file} is not 16 kHz mono`)
    }
    if (id === 'data') {
      const data = wav.subarray(offset + 8, offset + 8 + size)
      if (format === 3) return new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length))
      if (format === 1) return Float32Array.from({ length: data.length / 2 }, (_, index) => data.readInt16LE(index * 2) / 32_768)
      throw new Error(`${file} has format ${format}`)
    }
    offset += 8 + size
  }
  throw new Error(`${file} has no data`)
}

/** The edit distance between two texts, by code point, over the length of the second. */
function errorRate(text: string, reference: string): number {
  const a = [...text]
  const b = [...reference]
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    previous = current
  }
  return previous[b.length] / Math.max(1, b.length)
}

/** The physical footprint and its peak of the process, as `vmmap --summary` reports them on a Mac. */
function footprint(pid: string): string {
  const summary = execFileSync('vmmap', ['--summary', pid], { encoding: 'utf8', windowsHide: true })
  return summary.split('\n').filter((line) => line.startsWith('Physical footprint')).map((line) => line.replace(/\s+/g, ' ').trim()).join(', ')
}

interface Request { model: string; input: string; kind: string; language: string | null; official: string }

const LOCALES: Record<string, ConversationLocale> = { ja: 'ja-JP', en: 'en-US', de: 'de-DE' }
/** Each model by the name of its model information, which requests.json names it by. */
const MODELS: Array<[ResolvedAsrModel, string]> = [
  ['qwen3-asr-1.7b', 'Qwen3-ASR-1.7B'],
  ['qwen3-asr-0.6b', 'Qwen3-ASR-0.6B'],
  ['parakeet-tdt_ctc-0.6b-ja', 'parakeet-tdt_ctc-0.6b-ja'],
  ['reazonspeech-nemo-v2', 'reazonspeech-nemo-v2'],
  ['parakeet-tdt-0.6b-v3', 'parakeet-tdt-0.6b-v3'],
  ['haas-ja-v1.0', 'Haas-ja-v1.0']
]

describe.skipIf(!userData || !clips)('the local speech recognition on the real speech worker', () => {
  let local: typeof import('../src/main/services/local-asr')
  let models: typeof import('../src/main/services/speech-models')
  let speech: string
  const requests = (): Request[] => (JSON.parse(fs.readFileSync(path.join(clips!, 'requests.json'), 'utf8')) as Request[])
    .filter((request) => request.kind === 'forced' && request.language !== null && request.language in LOCALES)
  const seconds = (samples: Float32Array): string => (samples.length / 16_000).toFixed(2)

  beforeAll(async () => {
    const { HOST, setCapabilities } = await import('./helpers/platform')
    setCapabilities(HOST)
    local = await import('../src/main/services/local-asr')
    models = await import('../src/main/services/speech-models')
    speech = (await import('../src/main/services/speech-binaries')).speechPath()
  })
  afterAll(() => local.stop())

  describe.each(MODELS)('%s', (id, name) => {
    const spec = ASR_MODEL_SPECS[id]
    const rows = (): Request[] => requests().filter((request) => request.model === name)
    const present = (): boolean => fs.existsSync(models.modelFilePath(models.speechCatalog()[spec.model])) && rows().length > 0

    it('recognizes the languages its file lists', ({ skip }) => {
      if (!present()) skip()
      const info = JSON.parse(execFileSync(speech, ['info', '--json', models.modelFilePath(models.speechCatalog()[spec.model])], { encoding: 'utf8', windowsHide: true })) as { languages: string[] }
      expect([...info.languages].sort()).toEqual([...spec.languages].sort())
    })

    it('loads', async ({ skip }) => {
      if (!present()) skip()
      local.stop()
      const started = performance.now()
      await expect(local.ensureWorker(spec)).resolves.toBe(true)
      console.log(`${spec.label}: ready after ${((performance.now() - started) / 1000).toFixed(2)} s`)
    }, 240_000)

    it('recognizes the first 20 s of the longest recording in a language it recognizes', async ({ skip }) => {
      if (!present()) skip()
      const [longest] = requests()
        .filter((request) => spec.languages.includes(request.language!))
        .map((request) => ({ request, samples: readWave(path.join(clips!, `${request.input}.wav`)) }))
        .sort((a, b) => b.samples.length - a.samples.length)
      mocks.settings.conversationLocale = LOCALES[longest.request.language!]
      const samples = longest.samples.slice(0, 20 * 16_000)
      const started = performance.now()
      const text = await local.transcribe(spec, samples)
      console.log(`${spec.label} first ${seconds(samples)} s of ${longest.request.input}: ${((performance.now() - started) / 1000).toFixed(3)} s\n  ${text}`)
      expect(text).not.toBe('')
      if (process.platform === 'darwin') {
        const pid = execFileSync('pgrep', ['-f', models.modelFilePath(models.speechCatalog()[spec.model])], { encoding: 'utf8', windowsHide: true }).trim()
        console.log(`${spec.label} worker ${pid} after it: ${footprint(pid)}`)
      }
    }, 240_000)

    it('writes the official text of each recording, with its language forced', async ({ skip }) => {
      if (!present()) skip()
      const rates: number[] = []
      for (const request of rows()) {
        mocks.settings.conversationLocale = LOCALES[request.language!]
        expect(asrLanguage(mocks.settings.conversationLocale)).toBe(request.language)
        const samples = readWave(path.join(clips!, `${request.input}.wav`))
        const started = performance.now()
        const text = await local.transcribe(spec, samples)
        const elapsed = (performance.now() - started) / 1000
        const rate = errorRate(text, request.official)
        rates.push(rate)
        console.log(`${spec.label} ${request.input} (${seconds(samples)} s of audio, ${request.language}): ${elapsed.toFixed(3)} s, ${text === request.official ? 'the official text' : `${(rate * 100).toFixed(1)}% from the official text`}\n  ours:     ${text}\n  official: ${request.official}`)
      }
      // A GPU and the 16-bit samples ASIST sends may take another word where the official model's margin between two is within their error.
      expect(rates.filter((rate) => rate === 0).length).toBeGreaterThanOrEqual(rows().length / 2)
    }, 240_000)

    it('writes a partial text of the last five seconds of its longest recording', async ({ skip }) => {
      if (!present()) skip()
      const [longest] = rows()
        .map((request) => ({ request, samples: readWave(path.join(clips!, `${request.input}.wav`)) }))
        .sort((a, b) => b.samples.length - a.samples.length)
      mocks.settings.conversationLocale = LOCALES[longest.request.language!]
      const started = performance.now()
      const text = await local.transcribePartial(spec, longest.samples.slice(-5 * 16_000))
      console.log(`${spec.label} partial of the last 5 s of ${longest.request.input}: ${((performance.now() - started) / 1000).toFixed(3)} s\n  ${text}\n  of: ${longest.request.official}`)
      expect(text).not.toBe('')
    }, 60_000)
  })
})
