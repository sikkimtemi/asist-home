---
title: 使っているモデル
description: このコンピュータで動くモデルと、API で呼ぶモデル。
sidebar:
  order: 1
---

## このコンピュータで動くもの

取得するものは、どれもバージョンと sha256 を固定しています。

| 用途 | モデル | 取得元 | ライセンス |
|---|---|---|---|
| 音声認識(メモリが 16GB 以上の Mac と、単体 GPU のメモリが 6GB 以上の Windows で勧める) | Qwen3-ASR 1.7B(GGUF、Q8_0) | `sakasegawa/Qwen3-ASR-1.7B-GGUF`(Qwen が公開したモデルを変換したもの) | Apache-2.0 |
| 音声認識(それより少ないとき、または Windows の内蔵 GPU で勧める) | Qwen3-ASR 0.6B(GGUF、Q8_0) | `sakasegawa/Qwen3-ASR-0.6B-GGUF`(Qwen が公開したモデルを変換したもの) | Apache-2.0 |
| 音声認識(日本語、選んだときだけ) | Haas-ja-v1.0(GGUF、Q8_0) | `sakasegawa/Haas-ja-v1.0-GGUF`(Third Intelligence が公開したモデルを変換したもの) | Apache-2.0 |
| 音声認識(日本語、選んだときだけ) | parakeet-tdt_ctc-0.6b-ja(GGUF、Q8_0) | `sakasegawa/parakeet-tdt_ctc-0.6b-ja-GGUF`(NVIDIA が公開したモデルを変換したもの) | CC BY 4.0 |
| 音声認識(日本語、選んだときだけ) | ReazonSpeech NeMo v2(GGUF、Q8_0) | `sakasegawa/reazonspeech-nemo-v2-GGUF`(Reazon Human Interaction Lab が公開した reazonspeech-nemo-v2 を変換したもの) | Apache-2.0 |
| 音声認識(英語、フランス語、ドイツ語、イタリア語、ポルトガル語、スペイン語、選んだときだけ) | parakeet-tdt-0.6b-v3(GGUF、F16) | `sakasegawa/parakeet-tdt-0.6b-v3-GGUF`(NVIDIA が公開したモデルを変換したもの) | CC BY 4.0 |
| 音声認識(ブラウザの中、予備) | Whisper small(ONNX、transformers.js) | `onnx-community/whisper-small` | MIT(OpenAI Whisper) |
| 声の区間の検出 | Silero VAD(ONNX、同梱) | 同梱 | MIT |
| マイクの雑音の抑制 | DeepFilterNet3(ONNX、同梱) | 同梱 | MIT か Apache-2.0 |
| 読み上げ(日本語の既定) | Irodori-TTS v4.1-Small-MF(GGUF、F16)。音声に戻すデコーダの Semantic-DACVAE-Japanese-32dim も同じファイルに入っています。3 つの声 | `sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF`(Aratako が公開したモデルを変換したもの) | MIT(デコーダの元の facebook/dacvae-watermarked は Apache-2.0) |
| 読み上げ | Qwen3-TTS 12Hz CustomVoice の 0.6B と 1.7B(GGUF、Q8_0)。サイズごとに 1 つのファイルで、音声のデコーダも入っています。9 つの声 | `sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF` と `sakasegawa/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF`(Qwen が公開したモデルを変換したもの) | Apache-2.0 |
| 話し終わりと相槌の間合い(MaAI、日本語) | 京都大学 MaAI team の `vap_jp_kyoto`、`bc_det_jp`、`vap_bc_2type_jp`、`vap_nod_jp`。エンコーダは kyutai の Mimi、CPC の事前学習の重みは facebookresearch/CPC_audio | Hugging Face の `maai-kyoto`、`dl.fbaipublicfiles.com` | MIT(Mimi は CC BY 4.0) |
| 相槌の種類の判定(日本語) | sbintuitions/modernbert-ja-70m を合成データで fine-tune したもの(ONNX int8) | [sakasegawa/modernbert-ja-70m-aizuchi](https://huggingface.co/sakasegawa/modernbert-ja-70m-aizuchi) | MIT |
| 記憶の意味検索 | multilingual-e5 small(ONNX int8) | `Xenova/multilingual-e5-small`(`intfloat/multilingual-e5-small` を変換したもの) | MIT |

音声認識の Qwen3-ASR と FastConformer の 4 つのモデル(parakeet-tdt_ctc-0.6b-ja、ReazonSpeech NeMo v2、parakeet-tdt-0.6b-v3、Haas-ja-v1.0)と、読み上げの Irodori-TTS と Qwen3-TTS は、アプリに同梱した speech.cpp で動かします。Mac では Metal で、Windows では Vulkan で GPU を使います。取得する大きさは、音声認識の Qwen3-ASR 1.7B が約 2.2GB、0.6B が約 0.8GB、parakeet-tdt_ctc-0.6b-ja と ReazonSpeech NeMo v2 と Haas-ja-v1.0 がそれぞれ約 0.66GB、parakeet-tdt-0.6b-v3 が約 1.3GB、Irodori-TTS が約 1.9GB、Qwen3-TTS の 0.6B が約 1.2GB、1.7B が約 2.3GB です。同梱しているプログラムは[同梱しているもの](/docs/reference/bundled/)にあります。

音声認識の Qwen3-ASR は、ASIST の会話の 11 の言語をすべて聞き取ります。FastConformer の 4 つのモデルは、聞き取れる言語が限られます。Haas-ja-v1.0 と parakeet-tdt_ctc-0.6b-ja と ReazonSpeech NeMo v2 は日本語だけを聞き取ります。parakeet-tdt-0.6b-v3 はヨーロッパの 25 の言語を聞き取り、会話の言語のうちでは英語、フランス語、ドイツ語、イタリア語、ポルトガル語、スペイン語です。韓国語、ヒンディー語、インドネシア語を聞き取れるのは Qwen3-ASR だけです。モデルを自動で選ぶときは Qwen3-ASR を使い、FastConformer のモデルは設定の「声」で選んだときだけ使います。日本語を読み上げた文(Common Voice 8.0 の 4,483 本)では、parakeet-tdt_ctc-0.6b-ja が Qwen3-ASR 1.7B より誤りが少なく、速く書き起こしました。ふだんの会話の話し言葉では、まだ比べていません。

音声認識と MaAI と相槌の種類の判定は、会話のマイクを入れているあいだだけ読み込み、マイクを切ると止めます。Irodori-TTS と Qwen3-TTS は、マイクを入れたときと、何かを読み上げるときに読み込みます。マイクを切ったあとは、5 分のあいだ何も読み上げなければ止めます。ウィンドウを閉じているときと最小化しているときは、言いかけの返事が終われば止めます。止めると、Mac ではメモリが、Windows では GPU のメモリが空きます。読み込み直すのは、ファイルが OS のキャッシュに残っていれば長くても 3 秒ほどで、ふつうはマイクを入れてから最初の返事を読み上げるまでに終わります。声のエンジンが Gemini Live のときは、どれも読み込みません。

Irodori-TTS のモデルカードは、本人の同意なしに声を複製したりなりすましたりすることと、ディープフェイクや誤った情報を作ることを禁じています。ASIST の 3 つの声は、Irodori-TTS に声の説明を渡して作った声で、実在の人の声ではありません。

読み上げには、ほかに OS の音声合成(「macOS の音声合成」か「Windows の音声合成」)と、別のアプリとして動く VOICEVOX、AivisSpeech を使えます。VOICEVOX と AivisSpeech の声には、それぞれの利用規約があります。

## API で呼ぶもの

| 用途 | モデル | 提供元 |
|---|---|---|
| 会話、つなぎの一言、履歴の要約 | Claude Sonnet 5、Claude Haiku 4.5、Claude Opus 5 | Anthropic |
| 同上 | GPT-5.6 Luna、GPT-5.6 Terra、GPT-5.6 Sol | OpenAI |
| 同上 | GPT-5.6 Luna、GPT-5.6 Terra、GPT-5.6 Sol(ChatGPT のプランで) | ChatGPT(OpenAI) |
| 同上 | Gemini 3.8 Flash、Gemini 3.5 Flash Lite | Google |
| 同上 | Qwen 3.8 27B、GPT OSS 120B | Cerebras |
| 声のエンジン | `gemini-3.8-live`、`gemini-3.8-live-extended-thinking` | Google |

会話に選べるモデルの一覧と既定は [llm-catalog.ts](https://github.com/nyosegawa/asist/blob/main/src/shared/llm-catalog.ts) にあります。Agent のジョブと記憶の整理が使うモデルは、codex と claude の CLI が決めます。
