import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asrModelFiles, asrModelSpec, recommendAsrModel } from '@shared/asr-models'
import type { AppSettings } from '@shared/ipc'
import type { PinnedFile } from '@shared/pinned-file'
import { localTtsModel } from '@shared/tts-models'
import { MACOS, WINDOWS_WITHOUT_GPU, WINDOWS_INTEGRATED, setCapabilities } from './helpers/platform'
import { SPEECH_MODELS_OUTPUT, TEST_SPEECH_CATALOG } from './helpers/speech-catalog'

const mocks = vi.hoisted(() => ({
  directory: '',
  settings: {} as Pick<AppSettings, 'uiLocale' | 'voiceEngine' | 'ttsEngine' | 'qwenTtsSize' | 'asrModel'>
}))
vi.mock('../src/main/services/platform', () => import('./helpers/platform'))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app', getPath: () => mocks.directory, getVersion: () => '0.0.0', on: vi.fn() } }))
vi.mock('../src/main/services/settings', () => ({ getSettings: () => mocks.settings }))

import { SPEECH_MODEL_NOTICES_FORMAT, takeSpeechModelNotices } from '../src/main/services/speech-model-notices'
import { modelFilePath } from '../src/main/services/speech-models'

const IRODORI = localTtsModel('irodori', '0.6b', TEST_SPEECH_CATALOG)
/** The model the automatic choice stands for on the 32 GB Mac of the fixture. */
const RECOGNITION = asrModelSpec(recommendAsrModel('metal', 32).recommendedModel)
const bytesOf = (files: readonly PinnedFile[]): number => files.reduce((sum, file) => sum + file.bytes, 0)

const install = (files: readonly PinnedFile[]): void => {
  for (const file of files) {
    fs.mkdirSync(path.dirname(modelFilePath(file)), { recursive: true })
    fs.writeFileSync(modelFilePath(file), 'gguf')
  }
}
const record = (): string => path.join(mocks.directory, SPEECH_MODEL_NOTICES_FORMAT.name)
const told = (): unknown => JSON.parse(fs.readFileSync(record(), 'utf8'))

beforeEach(() => {
  const readFile = fs.readFileSync
  vi.spyOn(fs, 'readFileSync').mockImplementation((file, options) =>
    String(file) === path.join('/app', 'resources', 'speech', 'catalog.json') ? SPEECH_MODELS_OUTPUT : readFile(file, options))
  mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asist-speech-model-notices-'))
  mocks.settings = { uiLocale: 'en-US', voiceEngine: 'cascade', ttsEngine: 'irodori', qwenTtsSize: '0.6b', asrModel: 'auto' }
  setCapabilities(MACOS)
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(mocks.directory, { recursive: true, force: true })
})

describe('telling the user once about the local speech models that need preparing', () => {
  it('notifies once about Haas on integrated graphics without asking to prepare unavailable synthesis', () => {
    setCapabilities(WINDOWS_INTEGRATED)
    mocks.settings.asrModel = 'haas-ja-v1.0'
    const spec = asrModelSpec('haas-ja-v1.0')
    expect(takeSpeechModelNotices()).toEqual([{ target: 'asr', label: spec.label, downloadBytes: bytesOf(asrModelFiles(spec, TEST_SPEECH_CATALOG)) }])
    expect(takeSpeechModelNotices()).toEqual([])
  })
  it('tells about the reading model whose files are missing, with what preparing it downloads, and not a second time', () => {
    install(asrModelFiles(RECOGNITION, TEST_SPEECH_CATALOG))
    expect(takeSpeechModelNotices()).toEqual([{ target: 'tts', label: IRODORI.label, downloadBytes: bytesOf(IRODORI.files) }])
    expect(takeSpeechModelNotices()).toEqual([])
  })

  it('tells about the recognition model the automatic choice stands for', () => {
    mocks.settings.ttsEngine = 'system'
    expect(takeSpeechModelNotices()).toEqual([{ target: 'asr', label: RECOGNITION.label, downloadBytes: bytesOf(asrModelFiles(RECOGNITION, TEST_SPEECH_CATALOG)) }])
  })

  it('tells about the FastConformer model the setting chose, by its own name, and not the one auto would stand for', () => {
    const PARAKEET = asrModelSpec('parakeet-tdt_ctc-0.6b-ja')
    mocks.settings.ttsEngine = 'system'
    mocks.settings.asrModel = 'parakeet-tdt_ctc-0.6b-ja'
    install(asrModelFiles(RECOGNITION, TEST_SPEECH_CATALOG))
    expect(takeSpeechModelNotices()).toEqual([{ target: 'asr', label: PARAKEET.label, downloadBytes: bytesOf(asrModelFiles(PARAKEET, TEST_SPEECH_CATALOG)) }])
  })

  it('counts only the files still missing in what preparing downloads', () => {
    install(asrModelFiles(RECOGNITION, TEST_SPEECH_CATALOG))
    install(IRODORI.files.slice(1))
    expect(takeSpeechModelNotices()).toEqual([{ target: 'tts', label: IRODORI.label, downloadBytes: IRODORI.files[0].bytes }])
  })

  it('tells again once an update pins other files of a model it told about, and forgets the pins no model uses', () => {
    install(asrModelFiles(RECOGNITION, TEST_SPEECH_CATALOG))
    const earlier = IRODORI.files.map(({ repo, file }) => ({ repo, file, sha256: '0'.repeat(64) }))
    fs.writeFileSync(record(), JSON.stringify({ version: 2, told: earlier }))
    expect(takeSpeechModelNotices()).toEqual([{ target: 'tts', label: IRODORI.label, downloadBytes: bytesOf(IRODORI.files) }])
    expect(told()).toEqual({ version: 2, told: IRODORI.files.map(({ repo, file, sha256 }) => ({ repo, file, sha256 })) })
  })
  it('tells nothing about models whose files are there', () => {
    install([...asrModelFiles(RECOGNITION, TEST_SPEECH_CATALOG), ...IRODORI.files])
    expect(takeSpeechModelNotices()).toEqual([])
  })

  it('tells nothing while a live engine listens and speaks by itself', () => {
    mocks.settings.voiceEngine = 'gemini-live'
    expect(takeSpeechModelNotices()).toEqual([])
  })

  it('tells nothing on a machine that cannot run the local speech models', () => {
    setCapabilities(WINDOWS_WITHOUT_GPU)
    expect(takeSpeechModelNotices()).toEqual([])
  })

  it('refuses a record it cannot read rather than telling everything again', () => {
    fs.writeFileSync(record(), '{"version": 1, "told": [')
    expect(() => takeSpeechModelNotices()).toThrow()
    expect(fs.readFileSync(record(), 'utf8')).toBe('{"version": 1, "told": [')
  })
})
