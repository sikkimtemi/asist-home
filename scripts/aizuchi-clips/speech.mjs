import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { ASR_MODEL_SPECS } from '../../src/shared/asr-models.ts'
import { WORKER_PROTOCOL } from '../../src/shared/speech-worker-protocol.ts'
import { parseSpeechCatalog } from '../../src/shared/speech-catalog.ts'
import { IRODORI_TTS_MODEL, IRODORI_TTS_VOICE_IDS, QWEN_TTS_MODELS } from '../../src/shared/tts-models.ts'
import { RATE } from './cut.mjs'

/**
 * The bundled speech, run on the model files the app has prepared, so that the clips are read by the same program
 * and model as the rest of a reply and heard by the same speech recognition as the user's speech.
 */

const root = path.resolve(import.meta.dirname, '../..')
const exe = process.platform === 'win32' ? '.exe' : ''

/** The app's speech models, or the folder ASIST_SPEECH_MODELS names. */
function modelsDir() {
  if (process.env.ASIST_SPEECH_MODELS) return process.env.ASIST_SPEECH_MODELS
  const userData = process.platform === 'win32' ? path.join(process.env.APPDATA, 'asist') : path.join(homedir(), 'Library/Application Support/asist')
  return path.join(userData, 'speech-models')
}

/** The files of the speech models, as the catalog of the bundled speech pins them. */
export function speechCatalog() {
  return parseSpeechCatalog(readFileSync(path.join(root, 'resources', 'speech', 'catalog.json'), 'utf8'))
}

/** The path of the file of a model of the catalog, by its name, where the app keeps it once prepared. */
export function modelPath(name) {
  const file = speechCatalog()[name]
  const found = path.join(modelsDir(), file.repo.replace('/', '--'), file.sha256, file.file)
  if (!existsSync(found)) throw new Error(`${file.file} is not in ${modelsDir()}; prepare the model in the app first`)
  return found
}

function program(dir, name) {
  const found = path.join(root, 'resources', dir, name + exe)
  if (!existsSync(found)) throw new Error(`${found} is missing; run node scripts/prepare-resources.mjs dev`)
  return found
}

/**
 * The model each engine's clips are read with: Qwen3-TTS 0.6B, whose clips the app plays for both sizes, and
 * Irodori-TTS with the voice files the app ships.
 */
export const TTS_MODELS = {
  qwen3tts: QWEN_TTS_MODELS['0.6b'].model,
  irodori: IRODORI_TTS_MODEL.model
}

/** The bundled speech, which prepare-resources puts in resources/speech. */
export const speechProgram = () => program('speech', 'speech')

function workerArgs(engine) {
  if (engine === 'qwen3tts') return ['worker', modelPath(TTS_MODELS.qwen3tts)]
  if (engine !== 'irodori') throw new Error(`no aizuchi clips are made for ${engine}`)
  const voices = IRODORI_TTS_VOICE_IDS.flatMap((voice) => ['--add-voice', `${voice}=${path.join(root, 'resources', 'irodori-voices', `${voice}.voice.gguf`)}`])
  return ['worker', modelPath(IRODORI_TTS_MODEL.model), ...voices]
}

/** The `error` member of `error` and `fatal`, written as speech's command line writes a failure. */
const describeError = ({ code, option, message }) => `${code}${typeof option === 'string' ? ` (${option})` : ''}: ${message}`

/**
 * Halves the sample rate. A windowed-sinc low-pass at 0.45 of the new rate keeps what lies above the new
 * Nyquist frequency from folding back into the voice.
 */
function halve(samples) {
  const taps = 63
  const middle = (taps - 1) / 2
  const kernel = Array.from({ length: taps }, (_, i) => {
    const x = i - middle
    const sinc = x === 0 ? 0.45 : Math.sin(Math.PI * 0.45 * x) / (Math.PI * x)
    return sinc * (0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1)))
  })
  const sum = kernel.reduce((total, value) => total + value, 0)
  const out = new Float32Array(Math.floor(samples.length / 2))
  for (let n = 0; n < out.length; n++) {
    let value = 0
    for (let k = 0; k < taps; k++) {
      const index = 2 * n + k - middle
      if (index >= 0 && index < samples.length) value += samples[index] * kernel[k]
    }
    out[n] = value / sum
  }
  return out
}

/** Encodes samples as base64 of 16-bit little-endian PCM, which the worker reads as x / 32768. */
function encodePcm(samples) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), i * 2)
  return data.toString('base64')
}

/**
 * Starts `speech worker` with the arguments and resolves, once the model is loaded, to its model information and a
 * function that sends a request's lines and resolves to its `end` and the chunks before it. Every line of the
 * worker's stdout is one JSON object, and anything else on it, or an answer to no request in flight, stops the script.
 * A worker that exits or whose pipes fail rejects its start and every request in flight or sent later, so that the
 * script reaches its cleanup instead of waiting for an answer that cannot come.
 */
async function startWorker(args) {
  const child = spawn(speechProgram(), args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
  const pending = new Map()
  let ready
  let failure = null
  const started = new Promise((resolve, reject) => {
    ready = resolve
    const fail = (error) => {
      if (failure) return
      failure = error
      reject(error)
      for (const request of pending.values()) request.reject(error)
      pending.clear()
    }
    child.once('exit', (code) => fail(new Error(`speech worker exited (${code})`)))
    child.once('error', fail)
    child.stdin.on('error', fail)
    child.stdout.on('error', fail)
  })
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (typeof message !== 'object' || message === null || Array.isArray(message)) throw new Error(`speech worker wrote a line that is not a JSON object: ${line}`)
    if (message.type === 'ready') {
      if (message.protocol !== WORKER_PROTOCOL) throw new Error(`speech worker speaks protocol ${message.protocol}, and the script speaks ${WORKER_PROTOCOL}`)
      return ready(message.model)
    }
    if (message.type === 'fatal') throw new Error(`speech worker: ${describeError(message.error)}`)
    if (!['chunk', 'progress', 'end', 'error', 'cancelled'].includes(message.type)) return
    if (message.type === 'error' && typeof message.id !== 'string') throw new Error(`speech worker could not take a line the script sent: ${describeError(message.error)}`)
    const request = pending.get(message.id)
    if (!request) throw new Error(`speech worker sent ${message.type} for ${message.id}, which no request in flight has`)
    if (message.type === 'chunk') request.chunks.push(Buffer.from(message.pcm, 'base64'))
    else if (message.type !== 'progress') {
      pending.delete(message.id)
      if (message.type === 'end') request.resolve({ end: message, pcm: Buffer.concat(request.chunks) })
      else if (message.type === 'error') request.reject(new Error(describeError(message.error)))
      else throw new Error(`speech worker cancelled ${message.id}, which the script did not cancel`)
    }
  })
  const model = await started
  let next = 0
  return {
    model,
    request(lines) {
      if (failure) return Promise.reject(failure)
      const id = String(next++)
      const answer = new Promise((resolve, reject) => pending.set(id, { chunks: [], resolve, reject }))
      for (const line of lines(id)) child.stdin.write(JSON.stringify(line) + '\n')
      return answer
    },
    stop: () => child.kill()
  }
}

/**
 * Starts the worker on the engine's model and resolves to a function that reads a text and resolves to its samples
 * at RATE. A request carries no speed, so a clip is read at the model's own speed as in the app.
 */
export async function startSynthesizer(engine) {
  const worker = await startWorker(workerArgs(engine))
  const rate = worker.model.sample_rate
  if (rate !== RATE && rate !== 2 * RATE) throw new Error(`speech worker speaks at ${rate} Hz, which the clips cannot be made from`)
  return {
    async speak(text, voice, language) {
      const { pcm } = await worker.request((id) => [{ type: 'synthesize', id, text, voice, language }])
      const samples = new Float32Array(pcm.length / 2)
      for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768
      return rate === RATE ? samples : halve(samples)
    },
    stop: worker.stop
  }
}

/**
 * Starts the worker on Qwen3-ASR 1.7B and resolves to a function that transcribes samples at RATE, in the language
 * named by its BCP 47 tag, which the worker resamples to the model's rate.
 */
export async function startRecognizer() {
  const worker = await startWorker(['worker', modelPath(ASR_MODEL_SPECS['qwen3-asr-1.7b'].model)])
  return {
    async recognize(samples, language = 'ja') {
      const { end } = await worker.request((id) => [
        { type: 'chunk', id, seq: 0, pcm: encodePcm(samples) },
        { type: 'transcribe', id, sample_rate: RATE, language }
      ])
      return end.text.trim()
    },
    stop: worker.stop
  }
}
