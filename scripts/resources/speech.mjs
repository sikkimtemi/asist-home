import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { download, extract, stampCurrent, withTemporaryDir, writeStamp } from './shared.mjs'

/**
 * Puts speech.cpp's `speech` into resources/speech, pinned to one release and verified by sha256. The local
 * speech recognition and speech synthesis run in its worker, `speech worker MODEL`: Metal on a Mac, Vulkan on
 * Windows. The executable links the library and ggml statically, so it is one file, and the shared library and
 * the header the archive also holds are left out.
 */

export const VERSION = '0.10.1'
const MODULE = fileURLToPath(import.meta.url)
const CATALOG_SHA256 = '55cde7d0a1285c4c8e0731c4c32a2b585acb9fd824df36c8f475c7217032f732'

const ASSETS = {
  'darwin-arm64': {
    name: 'speech-0.10.1-macos-arm64-metal.zip',
    sha256: 'ff24f6f58c9d2dedb01caa88ba043ae845c76eff228e4cbfae5de749174404c1',
    program: 'speech'
  },
  'win32-x64': {
    name: 'speech-0.10.1-windows-x64-vulkan.zip',
    sha256: 'a8fe0e4b4f463c460e7ace9d38c363bec08b254cac5a7f764b7967af35d4fa1a',
    program: 'speech.exe'
  }
}

export async function prepareSpeech({ resources, platform, arch }) {
  const asset = ASSETS[`${platform}-${arch}`]
  if (!asset) throw new Error(`speech.cpp ${VERSION} is not pinned for ${platform} ${arch}`)
  // speech.cpp releases before 0.7.0 were prepared into resources/speech-worker, and llama.cpp's llama-server, which
  // ran the speech recognition before speech did, into resources/llama.cpp. Git no longer ignores either, so a
  // checkout that prepared one would otherwise show it as new files to commit.
  for (const replaced of ['speech-worker', 'llama.cpp']) fs.rmSync(path.join(resources, replaced), { recursive: true, force: true })
  const out = path.join(resources, 'speech')
  const stamp = path.join(out, 'VERSION')
  if (stampCurrent(stamp, VERSION, MODULE)) return

  await withTemporaryDir('asist-speech-', async (work) => {
    const base = 'https://github.com/nyosegawa/speech.cpp'
    const archive = path.join(work, asset.name)
    console.error(`speech.cpp: fetching ${VERSION}`)
    await download(`${base}/releases/download/v${VERSION}/${asset.name}`, archive, asset.sha256)
    extract(archive, path.join(work, 'unpacked'))
    await download(`${base}/raw/v${VERSION}/LICENSE`, path.join(work, 'LICENSE'))
    await download(`${base}/raw/v${VERSION}/tools/catalog/catalog.json`, path.join(work, 'catalog.json'), CATALOG_SHA256)
    fs.rmSync(out, { recursive: true, force: true })
    fs.mkdirSync(out, { recursive: true })
    fs.copyFileSync(path.join(work, 'unpacked', asset.program), path.join(out, asset.program))
    fs.chmodSync(path.join(out, asset.program), 0o755)
    fs.copyFileSync(path.join(work, 'LICENSE'), path.join(out, 'LICENSE'))
    fs.copyFileSync(path.join(work, 'catalog.json'), path.join(out, 'catalog.json'))
    writeStamp(stamp, VERSION, MODULE)
  })
}
