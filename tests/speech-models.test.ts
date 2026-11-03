import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ASR_MODEL_SPECS, asrModelFiles } from '@shared/asr-models'
import type { SetupProgress } from '@shared/ipc'
import type { PinnedFile } from '@shared/pinned-file'
import { QWEN_TTS_SIZES, localTtsModel } from '@shared/tts-models'
import { SPEECH_MODELS_OUTPUT, TEST_SPEECH_CATALOG } from './helpers/speech-catalog'
import { MACOS, WINDOWS_INTEGRATED, setCapabilities } from './helpers/platform'

const mocks = vi.hoisted(() => ({ directory: '' }))
vi.mock('../src/main/services/platform', () => import('./helpers/platform'))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app', getPath: () => mocks.directory, getVersion: () => '0.0.0' } }))
vi.mock('../src/main/services/settings', () => ({ getSettings: () => ({ uiLocale: 'en-US' }) }))
vi.mock('node:child_process', () => ({ execFileSync: () => { throw new Error('Vulkan runtime is unavailable') } }))

import { t } from '../src/main/services/i18n'
import { speechCatalog, modelFilePath, pinnedSpeechModelFiles, prepareModelFiles, removeUnpinnedFiles } from '../src/main/services/speech-models'

const sha256 = (content: string): string => crypto.createHash('sha256').update(content).digest('hex')

/** The commit of the pins, under which ASIST before 0.8 kept their files. */
const REVISION = '0123456789abcdef0123456789abcdef01234567'

/** The pin of a file whose content is its own name, as install writes it. */
const pin = (repo: string, file: string): PinnedFile => ({ repo, revision: REVISION, file, sha256: sha256(file), bytes: file.length })

const FILE = pin('owner/model-GGUF', 'model.gguf')

beforeEach(() => {
  mocks.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asist-speech-models-'))
  const readFile = fs.readFileSync
  vi.spyOn(fs, 'readFileSync').mockImplementation((file, options) =>
    String(file) === path.join('/app', 'resources', 'speech', 'catalog.json') ? SPEECH_MODELS_OUTPUT : readFile(file, options))
})
afterEach(() => {
  setCapabilities(MACOS)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fs.rmSync(mocks.directory, { recursive: true, force: true })
})

const install = (file: PinnedFile): void => {
  fs.mkdirSync(path.dirname(modelFilePath(file)), { recursive: true })
  fs.writeFileSync(modelFilePath(file), file.file)
}

const root = (): string => path.join(mocks.directory, 'speech-models')

const put = (parts: string[], content = 'gguf'): void => {
  const target = path.join(root(), ...parts)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

/** Every file and folder under speech-models, as paths relative to it. */
const tree = (): string[] =>
  fs.readdirSync(root(), { recursive: true, withFileTypes: true }).map((entry) => path.relative(root(), path.join(entry.parentPath, entry.name))).sort()

/** The folder of a pinned file's content and the file in it, as paths relative to speech-models. */
const placeOf = (file: PinnedFile): string[] => [path.relative(root(), path.dirname(modelFilePath(file))), path.relative(root(), modelFilePath(file))]

it('reads the bundled model pins even when the speech executable cannot start', () => {
  expect(speechCatalog()).toEqual(TEST_SPEECH_CATALOG)
})

describe('preparing the files of a local speech model', () => {
  it('prepares recognition on integrated graphics but refuses synthesis before downloading or starting it', async () => {
    setCapabilities(WINDOWS_INTEGRATED)
    install(FILE)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const start = vi.fn(async () => true)
    const options = { files: [FILE], label: 'Model', feature: 'Speech', signal: new AbortController().signal, onProgress: vi.fn(), selected: () => true, start }
    expect((await prepareModelFiles({ ...options, task: 'asr' })).ok).toBe(true)
    expect(start).toHaveBeenCalledOnce()
    start.mockClear()
    expect(await prepareModelFiles({ ...options, task: 'tts' })).toEqual({ ok: false, message: t('settingsModels.preparation.unsupported', { feature: 'Speech' }) })
    expect(fetch).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })
  it('starts the service on files that are already there without fetching anything', async () => {
    install(FILE)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const progress: SetupProgress[] = []
    const start = vi.fn(async () => true)
    const result = await prepareModelFiles({ task: 'asr', files: [FILE], label: 'Model', feature: 'Speech', signal: new AbortController().signal, onProgress: (p) => progress.push(p), selected: () => true, start })
    expect(result).toEqual({ ok: true, message: t('settingsModels.preparation.done', { model: 'Model' }) })
    expect(fetch).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledOnce()
    expect(progress.at(-1)?.status).toBe('done')
  })

  it('reports a service that does not start on the files by the name of the model', async () => {
    install(FILE)
    const progress: SetupProgress[] = []
    const result = await prepareModelFiles({ task: 'asr', files: [FILE], label: 'Model', feature: 'Speech', signal: new AbortController().signal, onProgress: (p) => progress.push(p), selected: () => true, start: async () => false })
    expect(result).toEqual({ ok: false, message: t('settingsModels.preparation.startFailed', { model: 'Model' }) })
    expect(progress.at(-1)?.status).toBe('error')
  })

  it('starts nothing and reports the files prepared when the settings no longer select the model once they are there', async () => {
    install(FILE)
    const progress: SetupProgress[] = []
    const start = vi.fn(async () => true)
    const result = await prepareModelFiles({ task: 'asr', files: [FILE], label: 'Model', feature: 'Speech', signal: new AbortController().signal, onProgress: (p) => progress.push(p), selected: () => false, start })
    expect(result.ok).toBe(true)
    expect(start).not.toHaveBeenCalled()
    expect(progress.at(-1)?.status).toBe('done')
  })

  it('does not count a start as failed when the settings turned away from the model while it loaded', async () => {
    install(FILE)
    let selected = true
    const result = await prepareModelFiles({ task: 'asr',
      files: [FILE],
      label: 'Model',
      feature: 'Speech',
      signal: new AbortController().signal,
      onProgress: () => {},
      selected: () => selected,
      // The change of the setting stops the model that was loading.
      start: async () => {
        selected = false
        return false
      }
    })
    expect(result.ok).toBe(true)
  })

  it('reports a preparation stopped during the download as cancelled and starts nothing', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      controller.abort()
      throw init?.signal?.reason ?? new DOMException('aborted', 'AbortError')
    }))
    const start = vi.fn(async () => true)
    const progress: SetupProgress[] = []
    const result = await prepareModelFiles({ task: 'asr', files: [FILE], label: 'Model', feature: 'Speech', signal: controller.signal, onProgress: (p) => progress.push(p), selected: () => true, start })
    expect(result).toEqual({ ok: false, message: t('settingsModels.preparation.cancelled', { feature: 'Speech' }) })
    expect(progress.at(-1)?.status).toBe('cancelled')
    expect(start).not.toHaveBeenCalled()
    expect(fs.existsSync(modelFilePath(FILE))).toBe(false)
  })
})

describe('removing the files no pin names at start', () => {
  const MMPROJ = pin('owner/model-GGUF', 'mmproj.gguf')
  const CODEC = pin('owner/voice-GGUF', 'codec.gguf')

  /**
   * The pins of a model and their leftovers: a download that never finished, an older file, the same file in the
   * folder of its commit where an earlier version kept it, an older repository, and things of another form.
   */
  const fillWithLeftovers = (): void => {
    for (const file of [FILE, MMPROJ, CODEC]) install(file)
    put([placeOf(FILE)[0], 'model.gguf.0123456789ab.tmp'])
    put(['owner--model-GGUF', sha256('older'), 'model.gguf'])
    put(['owner--model-GGUF', REVISION, FILE.file], FILE.file)
    put(['owner--voice-GGUF', sha256('older'), 'codec.gguf.ba9876543210.tmp'])
    put(['former--model-GGUF', sha256('former'), 'model.gguf'])
    put(['notes.txt'])
    put(['mine', 'model.gguf'])
  }

  it('keeps the pinned files and what is not a repository folder, and removes every other content, commit, repository and file', async () => {
    fillWithLeftovers()
    await removeUnpinnedFiles([FILE, MMPROJ, CODEC])
    expect(tree()).toEqual(
      ['mine', path.join('mine', 'model.gguf'), 'notes.txt', 'owner--model-GGUF', 'owner--voice-GGUF', ...[FILE, MMPROJ, CODEC].flatMap(placeOf)].sort()
    )
  })

  it('keeps the files of a pin whose repository is written in another case, which macOS and Windows find under either', async () => {
    install(FILE)
    await removeUnpinnedFiles([{ ...FILE, repo: 'OWNER/Model-gguf' }])
    expect(fs.existsSync(modelFilePath(FILE))).toBe(true)
  })

  it('keeps every file that preparing a model the settings can name fetches', async () => {
    const needed = [
      ...(['irodori', 'qwen3tts'] as const).flatMap((engine) => QWEN_TTS_SIZES.flatMap((size) => localTtsModel(engine, size, TEST_SPEECH_CATALOG).files)),
      ...Object.values(ASR_MODEL_SPECS).flatMap((spec) => asrModelFiles(spec, TEST_SPEECH_CATALOG))
    ]
    for (const file of needed) install(file)
    const before = tree()
    await removeUnpinnedFiles(pinnedSpeechModelFiles())
    expect(tree()).toEqual(before)
  })

  it('logs a folder it cannot remove and goes on with the others', async () => {
    fillWithLeftovers()
    const remove = fs.promises.rm
    vi.spyOn(fs.promises, 'rm').mockImplementation(async (target, options) => {
      if (path.basename(String(target)) === 'former--model-GGUF') throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      return remove(target, options)
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await removeUnpinnedFiles([FILE, MMPROJ, CODEC])
    expect(fs.existsSync(path.join(root(), 'former--model-GGUF'))).toBe(true)
    expect(fs.existsSync(path.join(root(), 'owner--model-GGUF', REVISION))).toBe(false)
    expect(fs.existsSync(path.join(root(), 'owner--voice-GGUF', sha256('older')))).toBe(false)
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('former--model-GGUF'), expect.any(Error))
  })
})
