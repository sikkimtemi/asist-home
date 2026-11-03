import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { asrLanguage, asrModelFiles, type AsrModelSpec } from '@shared/asr-models'
import type { SetupProgress } from '@shared/ipc'
import { errorText } from '@shared/i18n/error-text'
import { appendTranscript, splitRecognitionAudio } from './asr-utterance'
import { conversationLocale } from './conversation-locale'
import { t } from './i18n'
import { platformCapabilities } from './platform'
import { speechPath } from './speech-binaries'
import { filesInstalled, modelFilePath, prepareModelFiles, speechCatalog } from './speech-models'
import { startSpeechWorker, type SpeechWorker, type WorkerMessage } from './speech-worker'

/**
 * Speech recognition in a speech.cpp worker of its own, beside the one that reads the replies, on the GPU the
 * capabilities chose. The worker runs one model, Qwen3-ASR or a FastConformer model, and recognizes one request at a
 * time, in the order they arrive; every model takes the same requests. A recording goes to it as 16-bit samples on
 * its stdin and is never written to disk.
 */

/**
 * A request left unanswered this long means the worker is hung, and it is stopped. The worker answers one
 * request at a time, so the time also covers the requests queued ahead. A worker that sends nothing for as
 * long while it has a request in flight, a cancelled partial included, is stopped as hung too.
 */
const ANSWER_TIMEOUT_MS = 60_000

/**
 * How long a caller waits for a partial transcription. One still unanswered then is cancelled, so that the
 * worker turns to the final transcription that may be waiting behind it.
 */
const PARTIAL_WAIT_MS = 4_000

/** The rate of the samples the renderer captures, at which the worker takes them. */
const SAMPLE_RATE = 16_000

/** The stops of a recognition's `end`: the whole text, or the text up to the most tokens the model writes. */
const RECOGNITION_STOPS: ReadonlySet<unknown> = new Set(['complete', 'model_limit'])

let worker: SpeechWorker | null = null
/** The model the running worker was started on. */
let workerModel: AsrModelSpec | null = null
let workerReady = false
let starting: Promise<boolean> | null = null
/** The transcriptions callers wait for, by request id, from the call until it settles. */
const transcriptions = new Map<string, AbortController>()
/** The preparation under way, with the model whose files it fetches. */
let preparation: { model: AsrModelSpec; controller: AbortController; operation: Promise<{ ok: boolean; message: string }> } | null = null

/** Whether the files of the model are there. */
export function installationStatus(model: AsrModelSpec): { modelInstalled: boolean } {
  return { modelInstalled: filesInstalled(asrModelFiles(model, speechCatalog())) }
}

export function available(model: AsrModelSpec): boolean {
  return worker !== null && workerModel === model && workerReady && worker.alive
}

/** Whether the worker on the model has been started and is still loading it. */
export function isStarting(model: AsrModelSpec): boolean {
  return starting !== null && workerModel === model
}

const stoppedError = (): Error => new DOMException(errorText('speechRecognition.errors.stopped'), 'AbortError')
const timedOutError = (): Error => new DOMException(errorText('speechRecognition.errors.timedOut'), 'TimeoutError')

/** Stops the worker and ends every transcription on it with `reason`. */
function stopWorker(reason: Error = stoppedError()): void {
  const stale = worker
  worker = null
  workerModel = null
  workerReady = false
  starting = null
  stale?.stop(reason)
}

/**
 * Starts the worker on the model unless it is running or starting on it already; a worker on another model is
 * stopped first. Resolves false when the model file is missing or the worker fails to start.
 */
export async function ensureWorker(model: AsrModelSpec): Promise<boolean> {
  if (available(model)) return true
  if (starting && workerModel === model) return starting
  stopWorker()
  const { localAsr } = platformCapabilities()
  // The capabilities leave the local speech recognition out where it does not run, so a start here is a caller's mistake.
  if (localAsr.backend === null) throw new Error('the local speech recognition cannot run on this machine')
  if (!installationStatus(model).modelInstalled) return false
  // speech ships with the app, so a missing one is a broken build rather than something to prepare.
  if (!fs.existsSync(speechPath())) throw new Error(`speech is missing from ${speechPath()}`)
  const started: SpeechWorker = startSpeechWorker(speechPath(), modelFilePath(speechCatalog()[model.model]), [], model.family, {
    task: 'recognition',
    device: localAsr.device,
    silence: { ms: ANSWER_TIMEOUT_MS, error: timedOutError },
    onFailure: (error) => {
      if (worker === started) stopWorker(error)
    }
  })
  worker = started
  workerModel = model
  const operation = started.ready
    .then((ready) => {
      if (worker !== started) return false
      workerReady = ready
      return ready
    })
    .finally(() => {
      if (starting === operation) starting = null
    })
  starting = operation
  return operation
}

/** Stops the worker and fails every transcription, those waiting for it to start included. */
export function stop(): void {
  const reason = stoppedError()
  stopWorker(reason)
  for (const controller of transcriptions.values()) controller.abort(reason)
  transcriptions.clear()
}

/** The samples as base64 of 16-bit little-endian PCM, which the worker reads as x / 32768. */
function encodePcm(samples: Float32Array): string {
  const data = Buffer.alloc(samples.length * 2)
  for (let index = 0; index < samples.length; index++) {
    data.writeInt16LE(Math.max(-32_768, Math.min(32_767, Math.round(samples[index] * 32_768))), index * 2)
  }
  return data.toString('base64')
}

/** The text of a recognition's `end`. Throws on one that breaks the protocol, which fails the worker. */
function transcriptOf(model: AsrModelSpec, message: WorkerMessage): string {
  if (typeof message.text !== 'string') throw new Error(`the worker ended recognition ${String(message.id)} without a text`)
  if (!RECOGNITION_STOPS.has(message.stop)) throw new Error(`the worker ended recognition ${String(message.id)} with the stop ${JSON.stringify(message.stop)}, which a recognition does not have`)
  if (message.stop === 'model_limit') console.warn(`${model.family}: recognition ${String(message.id)} stopped at the most tokens the model writes`)
  return message.text.trim()
}

async function request(model: AsrModelSpec, samples: Float32Array, id: string): Promise<string> {
  if (transcriptions.has(id)) throw new Error(`duplicate transcription request: ${id}`)
  const controller = new AbortController()
  transcriptions.set(id, controller)
  let timer: NodeJS.Timeout | undefined
  try {
    // The language is read here, per request, so that a change of the setting applies to the next
    // utterance without reloading the model.
    const language = asrLanguage(conversationLocale())
    if (!(await ensureWorker(model)) || !worker) throw new Error(errorText('speechRecognition.errors.notReady'))
    controller.signal.throwIfAborted()
    const target = worker
    // The time runs from the request, not from the start of the worker, which has its own limit.
    timer = setTimeout(() => {
      const timedOut = timedOutError()
      controller.abort(timedOut)
      if (worker === target) stopWorker(timedOut)
    }, ANSWER_TIMEOUT_MS)
    timer.unref?.()
    let text = ''
    let partId = id
    for (const part of splitRecognitionAudio(samples, SAMPLE_RATE)) {
      controller.signal.throwIfAborted()
      text = appendTranscript(text, await recognizePart(target, model, part, partId, language, controller.signal))
      partId = randomUUID()
    }
    return text
  } catch (error) {
    // A stop or a cancel while the worker started is the error the caller should see.
    throw controller.signal.aborted && controller.signal.reason instanceof Error ? controller.signal.reason : error
  } finally {
    clearTimeout(timer)
    transcriptions.delete(id)
  }
}

/** Recognizes one part on the utterance's worker and removes its abort listener when that part settles. */
async function recognizePart(target: SpeechWorker, model: AsrModelSpec, samples: Float32Array, id: string, language: string, signal: AbortSignal): Promise<string> {
  let aborted: () => void = () => {}
  try {
    return await new Promise<string>((resolve, reject) => {
      aborted = () => {
        target.cancel(id)
        reject(signal.reason)
      }
      signal.addEventListener('abort', aborted, { once: true })
      target.request(id, [
        { type: 'chunk', id, seq: 0, pcm: encodePcm(samples) },
        { type: 'transcribe', id, sample_rate: SAMPLE_RATE, language }
      ], {
        end: (message) => resolve(transcriptOf(model, message)),
        error: (reason) => reject(new Error(reason)),
        abandoned: reject
      })
    })
  } finally {
    signal.removeEventListener('abort', aborted)
  }
}

export function transcribe(model: AsrModelSpec, samples: Float32Array, requestId?: string): Promise<string> {
  return request(model, samples, requestId || randomUUID())
}

export async function transcribePartial(model: AsrModelSpec, samples: Float32Array): Promise<string> {
  // The worker answers one request at a time, so a partial sent while another request waits or runs, a
  // cancelled one included, would only delay the final transcription.
  if (transcriptions.size > 0 || (worker?.pending ?? 0) > 0) return ''
  const id = randomUUID()
  const answer = request(model, samples, id).catch(() => '')
  let timer: NodeJS.Timeout | undefined
  const abandoned = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      cancelTranscription(id)
      resolve('')
    }, PARTIAL_WAIT_MS)
  })
  try {
    return await Promise.race([answer, abandoned])
  } finally {
    clearTimeout(timer)
  }
}

export function cancelTranscription(requestId: string): boolean {
  const controller = transcriptions.get(requestId)
  if (!controller) return false
  controller.abort(stoppedError())
  return true
}

export function cancelPreparation(): boolean {
  if (!preparation) return false
  preparation.controller.abort()
  // A worker on another model is the one the setting moved to while the files downloaded, which the preparation did not start.
  if (workerModel === preparation.model) stop()
  return true
}

/**
 * Downloads the file of the model, and starts its worker on it if the setting still stands for the model once
 * it is there, which only the caller can tell.
 */
export function prepare(
  model: AsrModelSpec,
  selected: () => boolean,
  onProgress: (progress: SetupProgress) => void
): Promise<{ ok: boolean; message: string }> {
  if (preparation) return preparation.operation
  const controller = new AbortController()
  const operation = prepareModelFiles({
    task: 'asr',
    files: asrModelFiles(model, speechCatalog()),
    label: model.label,
    feature: t('settingsModels.features.speechRecognition'),
    signal: controller.signal,
    onProgress,
    selected,
    start: () => ensureWorker(model)
  }).finally(() => {
    if (preparation?.operation === operation) preparation = null
  })
  preparation = { model, controller, operation }
  return operation
}
