---
title: メモリの目安
description: このコンピュータで動くモデルが使うメモリ。
sidebar:
  order: 2
---

準備したモデルは、それぞれ専用のプロセスに常駐します。次の表は、Mac の M5(32GB)で測った値です。記憶の意味検索、相槌の種類の判定、話し終わりの判定は、起動から 30 秒後に `vmmap --summary` の physical footprint を測りました。音声認識は speech.cpp 0.7.1 で Qwen3-ASR(Q8_0)と FastConformer の 3 つ(F16)のモデルを、読み上げは speech.cpp 0.7.0 で Irodori-TTS(F16)と Qwen3-TTS(Q8_0)のモデルを動かして測りました。音声認識の Qwen3-ASR は 25 秒の発話を一つ、FastConformer の 3 つは ASIST が一度に送るいちばん長い 20 秒の発話を一つ書き起こさせたあとに、読み上げは一文を読ませたあとに測りました。parakeet の 2 つのモデルは、発話の長さの 2 乗に比例してメモリが増えます。ASIST は発話を 20 秒で区切って送るので、それより長い発話でメモリが増えることはありません。

| プロセス | モデル | メモリ | 動く条件 | 測った日 |
|---|---|---|---|---|
| 音声認識 | Qwen3-ASR 1.7B(Q8_0) | 2.5GB | 起動したとき(音声認識が Qwen3-ASR 1.7B のとき) | 2026-10-07 |
| 音声認識 | Qwen3-ASR 0.6B(Q8_0) | 1.1GB | 起動したとき(音声認識が Qwen3-ASR 0.6B のとき) | 2026-10-07 |
| 音声認識 | parakeet-tdt_ctc-0.6b-ja(F16) | 1.3GB | 起動したとき(音声認識が parakeet-tdt_ctc-0.6b-ja のとき) | 2026-10-07 |
| 音声認識 | ReazonSpeech NeMo v2(F16) | 1.3GB | 起動したとき(音声認識が ReazonSpeech NeMo v2 のとき) | 2026-10-07 |
| 音声認識 | parakeet-tdt-0.6b-v3(F16) | 1.3GB | 起動したとき(音声認識が parakeet-tdt-0.6b-v3 のとき) | 2026-10-07 |
| 読み上げ | Irodori-TTS v4.1-Small-MF(F16) | 2.0GB | 起動したとき(読み上げが Irodori-TTS のとき) | 2026-10-06 |
| 読み上げ | Qwen3-TTS 0.6B(Q8_0) | 1.6GB | 起動したとき(読み上げが Qwen3-TTS で、モデルが 0.6B のとき) | 2026-10-06 |
| 読み上げ | Qwen3-TTS 1.7B(Q8_0) | 2.6GB | 起動したとき(読み上げが Qwen3-TTS で、モデルが 1.7B のとき) | 2026-10-06 |
| 記憶の意味検索 | multilingual-e5 small(ONNX int8) | 655MB | 起動したとき(意味検索が有効のとき) | 2026-09-22 |
| 相槌の種類の判定 | ModernBERT-ja 70m(ONNX int8) | 325MB | 起動したとき(日本語で、相槌が有効で、Live のエンジンでないとき) | 2026-09-20 |
| 話し終わりの判定 | MaAI(PyTorch) | 685MB | マイクを入れたとき(日本語で、MaAI が有効のとき) | 2026-09-20 |

音声認識に Qwen3-ASR 1.7B を使い、ほかの 3 つも動くと、約 4.2GB です。音声認識が 0.6B なら約 2.8GB、FastConformer の 3 つのどれかなら約 3.0GB です。読み上げに Irodori-TTS を選ぶとさらに約 2.0GB、Qwen3-TTS を選ぶと 0.6B で約 1.6GB、1.7B で約 2.6GB を使います。アプリの本体と画面は、それぞれ約 90MB です。

Mac では、メモリが 16GB 以上なら音声認識に 1.7B を勧め、初回セットアップで Irodori-TTS と Qwen3-TTS を勧めます。16GB より少なければ、音声認識に 0.6B を勧めます。Qwen3-TTS の 1.7B は、メモリが 24GB 以上の Mac で選べます。

## Windows

Windows の内蔵 GPU でも音声認識を使えます。以下は単体 GPU の測定値で、Haas の実行時メモリは未計測です。

Windows の音声認識と読み上げ(Irodori-TTS と Qwen3-TTS)は、単体の GPU のメモリにモデルを載せます。GeForce RTX 2080(8GB)の Windows 11 で測った値は、次のとおりです。`nvidia-smi` が示す GPU 全体の使用量から、ASIST を起動してマイクを切っているときの 1.64GB を引いた値です。音声認識と Qwen3-TTS の 0.6B は 2026-10-07 に speech.cpp 0.7.1 で測りました。音声認識は 25.5 秒の発話を書き起こさせたあとの値で、読み込んだ直後は 1.7B が 2.3GB、0.6B が 0.9GB でした。書き起こす発話が長いほど増え、10.5 秒の発話のあとは 1.7B が 2.4GB、0.6B が 1.1GB でした。FastConformer の 3 つのモデルは、同じ日に speech.cpp 0.7.1 の `speech worker` だけを動かし、ワーカーを起動する前からの増え方を測りました。ASIST が一度に送るいちばん長い 20 秒の発話(日本語の 2 つのモデルは日本語の、parakeet-tdt-0.6b-v3 は英語の FLEURS の発話の最初の 20 秒)を書き起こさせたあとの値で、読み込んだ直後はどれも 1.2GB でした。Qwen3-TTS の 0.6B は、3 つの文を読ませたあとの値です。Irodori-TTS は 2026-10-01 に speech.cpp v0.3.0 で、Qwen3-TTS の 1.7B は 2026-09-29 に移す前の実装で測りました。

| モデル | GPU のメモリ |
|---|---|
| Qwen3-ASR 1.7B(Q8_0) | 2.7GB |
| Qwen3-ASR 0.6B(Q8_0) | 1.4GB |
| parakeet-tdt_ctc-0.6b-ja(F16) | 1.3GB |
| ReazonSpeech NeMo v2(F16) | 1.3GB |
| parakeet-tdt-0.6b-v3(F16) | 1.3GB |
| Irodori-TTS v4.1-Small-MF(F16) | 2.1GB |
| Qwen3-TTS 0.6B(Q8_0) | 1.3GB |
| Qwen3-TTS 1.7B(Q8_0) | 2.7GB |

Windows の画面の表示と、マイクを切っている ASIST も同じ GPU のメモリを使い、測ったときは 1.64GB でした。この分に表の値を足すと、音声認識の 1.7B と Irodori-TTS で約 6.4GB、Qwen3-TTS の 0.6B で約 5.6GB、Qwen3-TTS を 1.7B にすると約 7.0GB です。GPU のメモリが 6GB 以上なら音声認識に 1.7B を勧め、8GB 以上なら初回セットアップで Irodori-TTS と Qwen3-TTS も勧めるのはこのためです。6GB より少なければ、音声認識に 0.6B を勧めます。Qwen3-TTS の 1.7B は、GPU のメモリが 10GB 以上のときに選べます。

記憶の意味検索、相槌の種類の判定、話し終わりの判定は、Windows でも CPU とメインのメモリで動きます。Windows でのメモリの量は、まだ測っていません。
