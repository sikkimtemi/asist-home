import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { asrModelFiles, asrModelSpec, offeredAsrModels } from '@shared/asr-models'
import type { SetupProgress } from '@shared/ipc'
import { errorText } from '@shared/i18n/error-text'
import type { PinnedFile } from '@shared/pinned-file'
import { appSettingsSchema } from '@shared/settings'
import { parseSpeechCatalog, type SpeechCatalog } from '@shared/speech-catalog'
import { QWEN_TTS_SIZES, isLocalTtsEngine, localTtsModel } from '@shared/tts-models'
import { errorMessage, t } from './i18n'
import { platformCapabilities } from './platform'
import { downloadMissing } from './pinned-download'
import { resourcePath } from './resource-path'

/**
 * The GGUF files of the local speech models, under userData/speech-models, one folder per repository and
 * SHA-256 of a file's content, as speech.cpp keeps its own cache: a commit that changes only a model card moves
 * the catalog's pin and leaves the file where it is. A file is fetched to a temporary name and renamed into place
 * once its sha256 matches, so a file at its path is whole, and a set of files counts as installed when every one of
 * them is there.
 */

function modelsDir(): string {
  return path.join(app.getPath('userData'), 'speech-models')
}

let catalog: SpeechCatalog | null = null

/**
 * The model pins from the catalog shipped with the same release as speech. Reading the file does not need
 * the executable's GPU runtime, so Windows without Vulkan can still start the app and use cloud speech.
 */
export function speechCatalog(): SpeechCatalog {
  catalog ??= parseSpeechCatalog(fs.readFileSync(resourcePath('speech/catalog.json'), 'utf8'))
  return catalog
}

export function modelFilePath(file: PinnedFile): string {
  return path.join(modelsDir(), file.repo.replace('/', '--'), file.sha256, file.file)
}

export function fileInstalled(file: PinnedFile): boolean {
  return fs.existsSync(modelFilePath(file))
}

export function filesInstalled(files: readonly PinnedFile[]): boolean {
  return files.every(fileInstalled)
}

/**
 * Every file a preparation can fetch: the files of each local speech synthesis engine at each size of
 * Qwen3-TTS, and of each speech recognition model, whichever of them the settings name now.
 */
export function pinnedSpeechModelFiles(): PinnedFile[] {
  const engines = appSettingsSchema.shape.ttsEngine.options.filter(isLocalTtsEngine)
  return [
    ...engines.flatMap((engine) => QWEN_TTS_SIZES.flatMap((size) => localTtsModel(engine, size, speechCatalog()).files)),
    ...offeredAsrModels().flatMap((model) => asrModelFiles(asrModelSpec(model), speechCatalog()))
  ]
}

/** The entries of a folder, or none after logging why they could not be read. */
async function entriesOf(folder: string, name: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(folder, { withFileTypes: true })
  } catch (error) {
    console.error(`speech models: ${name} could not be read:`, error)
    return []
  }
}

/**
 * Removes from the folder whatever no file of `pinned` needs, so that the gigabytes of a model an update
 * pinned to other files do not stay for good: the folder of a repository no file names, a folder of a named
 * repository that no file names, such as one of another content or one of a commit, where an earlier version kept
 * its files, and any other file in a named folder, such as the temporary file of a download that never finished.
 * Only the folders at the top named <owner>--<name>, the form the folder of every repository has, are looked into;
 * anything else there is not of this layout and is left alone. It runs before anything can start a download, so no
 * temporary file it finds is still being written. A path that cannot be removed is logged and left for the next
 * start.
 */
export async function removeUnpinnedFiles(pinned: readonly PinnedFile[]): Promise<void> {
  const root = modelsDir()
  if (!fs.existsSync(root)) return
  // macOS and Windows find a file under any case of its name, so a pin whose repository changed only in case
  // still names the folder its files are in, which a comparison of the exact names would remove.
  const key = (target: string): string => target.toLowerCase()
  const files = new Set(pinned.map((file) => key(modelFilePath(file))))
  const folders = new Set<string>()
  for (const file of pinned) {
    for (let dir = path.dirname(modelFilePath(file)); dir.length > root.length; dir = path.dirname(dir)) folders.add(key(dir))
  }
  const remove = async (target: string): Promise<void> => {
    const name = path.relative(root, target)
    try {
      await fs.promises.rm(target, { recursive: true, force: true })
      console.log(`speech models: removed ${name}, which no pinned file needs`)
    } catch (error) {
      console.error(`speech models: ${name} could not be removed:`, error)
    }
  }
  const tidy = async (folder: string): Promise<void> => {
    for (const entry of await entriesOf(folder, path.relative(root, folder))) {
      const target = path.join(folder, entry.name)
      if (files.has(key(target))) continue
      if (folders.has(key(target))) await tidy(target)
      else await remove(target)
    }
  }
  for (const entry of await entriesOf(root, 'the folder')) {
    if (!entry.isDirectory() || !entry.name.includes('--')) continue
    const target = path.join(root, entry.name)
    if (folders.has(key(target))) await tidy(target)
    else await remove(target)
  }
}

export interface PrepareOptions {
  task: 'asr' | 'tts'
  files: readonly PinnedFile[]
  /** The model's name in the messages. */
  label: string
  /** What the feature is called in the messages, already in the interface language. */
  feature: string
  signal: AbortSignal
  onProgress: (progress: SetupProgress) => void
  /** Whether the settings select the model now, which the user can change while its files download. */
  selected: () => boolean
  /** Starts the service on the downloaded files and resolves to whether it became ready. */
  start: () => Promise<boolean>
}

/**
 * Downloads the files that are missing, then starts the service on them while the settings still select
 * the model, reporting each step as setup progress. A change of the setting starts what it selects, so a
 * model the user turned away from is left with its files in place and nothing of it running. The download
 * has no time limit, because the service's ready timeout would otherwise have to cover 2.5 GB on a slow line.
 */
export async function prepareModelFiles(options: PrepareOptions): Promise<{ ok: boolean; message: string }> {
  const { task, files, label, feature, signal, onProgress, selected, start } = options
  const capability = task === 'asr' ? platformCapabilities().localAsr : platformCapabilities().localTts
  if (capability.backend === null) return { ok: false, message: t('settingsModels.preparation.unsupported', { feature }) }
  try {
    if (!filesInstalled(files)) {
      const message = t('settingsModels.preparation.downloading', { model: label })
      onProgress({ status: 'downloading', pct: 0, downloadedMb: 0, totalMb: 0, message })
      await downloadMissing(files.map((file) => ({ file, target: modelFilePath(file) })), signal, (progress) =>
        onProgress({ status: 'downloading', pct: progress.pct, downloadedMb: progress.downloadedMb, totalMb: progress.totalMb, message }))
    }
    signal.throwIfAborted()
    if (selected()) {
      onProgress({ status: 'downloading', pct: 0, downloadedMb: 0, totalMb: 0, message: t('settingsModels.preparation.loading', { model: label }) })
      const ready = await start()
      signal.throwIfAborted()
      // Choosing another model while this one loads stops it, which is no failure of the preparation.
      if (!ready && selected()) throw new Error(errorText('settingsModels.preparation.startFailed', { model: label }))
    }
    onProgress({ status: 'done', pct: 100, downloadedMb: 0, totalMb: 0 })
    return { ok: true, message: t('settingsModels.preparation.done', { model: label }) }
  } catch (error) {
    const cancelled = signal.aborted
    const message = cancelled ? t('settingsModels.preparation.cancelled', { feature }) : errorMessage(error)
    onProgress({ status: cancelled ? 'cancelled' : 'error', pct: 0, downloadedMb: 0, totalMb: 0, message })
    return { ok: false, message }
  }
}
