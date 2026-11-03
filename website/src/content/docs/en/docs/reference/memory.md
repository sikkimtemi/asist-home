---
title: Memory requirements
description: How much memory the models that run on this computer use.
sidebar:
  order: 2
---

Each prepared model stays resident in a process of its own. The table below gives values measured on an M5 Mac (32GB). For searching the memory by meaning, choosing the kind of backchannel and detecting the end of a turn, it is the physical footprint from `vmmap --summary`, 30 seconds after launch. Speech recognition was measured running Qwen3-ASR (Q8_0) and the three FastConformer models (F16) in speech.cpp 0.7.1, and reading aloud running Irodori-TTS (F16) and Qwen3-TTS (Q8_0) in speech.cpp 0.7.0. Qwen3-ASR was measured after it had transcribed one utterance of 25 seconds, the three FastConformer models after one of 20 seconds, the longest utterance ASIST sends at once, and reading aloud after it had read one sentence. The memory of the two parakeet models grows with the square of the utterance's length. ASIST cuts an utterance at 20 seconds, so a longer one never makes them use more.

| Process | Model | Memory | Runs when | Measured on |
|---|---|---|---|---|
| Speech recognition | Qwen3-ASR 1.7B (Q8_0) | 2.5GB | At launch (when speech recognition is Qwen3-ASR 1.7B) | 2026-10-07 |
| Speech recognition | Qwen3-ASR 0.6B (Q8_0) | 1.1GB | At launch (when speech recognition is Qwen3-ASR 0.6B) | 2026-10-07 |
| Speech recognition | parakeet-tdt_ctc-0.6b-ja (F16) | 1.3GB | At launch (when speech recognition is parakeet-tdt_ctc-0.6b-ja) | 2026-10-07 |
| Speech recognition | ReazonSpeech NeMo v2 (F16) | 1.3GB | At launch (when speech recognition is ReazonSpeech NeMo v2) | 2026-10-07 |
| Speech recognition | parakeet-tdt-0.6b-v3 (F16) | 1.3GB | At launch (when speech recognition is parakeet-tdt-0.6b-v3) | 2026-10-07 |
| Reading aloud | Irodori-TTS v4.1-Small-MF (F16) | 2.0GB | At launch (when reading aloud uses Irodori-TTS) | 2026-10-06 |
| Reading aloud | Qwen3-TTS 0.6B (Q8_0) | 1.6GB | At launch (when reading aloud uses Qwen3-TTS with the 0.6B model) | 2026-10-06 |
| Reading aloud | Qwen3-TTS 1.7B (Q8_0) | 2.6GB | At launch (when reading aloud uses Qwen3-TTS with the 1.7B model) | 2026-10-06 |
| Searching the memory by meaning | multilingual-e5 small (ONNX int8) | 655MB | At launch (when semantic search is on) | 2026-09-22 |
| Choosing the kind of backchannel | ModernBERT-ja 70m (ONNX int8) | 325MB | At launch (in Japanese, with backchannels on, and not with a Live engine) | 2026-09-20 |
| Detecting the end of a turn | MaAI (PyTorch) | 685MB | When the microphone is turned on (in Japanese, with MaAI on) | 2026-09-20 |

With Qwen3-ASR 1.7B for speech recognition and the other three running, they use about 4.2GB; with 0.6B for speech recognition, about 2.8GB, and with any of the three FastConformer models, about 3.0GB. Choosing Irodori-TTS for reading aloud uses about 2.0GB more, and Qwen3-TTS about 1.6GB more with 0.6B and about 2.6GB more with 1.7B. The app itself and its window each use about 90MB.

On a Mac with 16GB of memory or more, ASIST recommends 1.7B for speech recognition, and the first-time setup recommends Irodori-TTS and Qwen3-TTS. With less than 16GB, it recommends 0.6B for speech recognition. The 1.7B size of Qwen3-TTS can be chosen on a Mac with 24GB of memory or more.

## Windows

Recognition can also use an integrated GPU on Windows. The measurements below are for a discrete GPU; this table has no measurement of Haas runtime memory.

On Windows, speech recognition and reading aloud (Irodori-TTS and Qwen3-TTS) load their models into the memory of a discrete GPU. Measured on a GeForce RTX 2080 (8GB) with Windows 11, as the use of the whole GPU that `nvidia-smi` reports, less the 1.64GB it showed with ASIST running and the microphone off. Speech recognition and 0.6B Qwen3-TTS were measured on 2026-10-07 with speech.cpp 0.7.1. Speech recognition is given after it transcribed an utterance of 25.5 seconds; just after loading, 1.7B took 2.3GB and 0.6B 0.9GB. It grows with the length of the utterance: after one of 10.5 seconds, 1.7B took 2.4GB and 0.6B 1.1GB. The three FastConformer models were measured on the same day running speech.cpp 0.7.1's `speech worker` alone, as the growth over the use before the worker started. They are given after transcribing 20 seconds, the longest utterance ASIST sends at once (the first 20 seconds of a FLEURS utterance, in Japanese for the two Japanese models and in English for parakeet-tdt-0.6b-v3); just after loading, each took 1.2GB. 0.6B Qwen3-TTS is given after it read three sentences. Irodori-TTS was measured on 2026-10-01 with speech.cpp v0.3.0, and 1.7B Qwen3-TTS on 2026-09-29 with the implementation used before.

| Model | GPU memory |
|---|---|
| Qwen3-ASR 1.7B (Q8_0) | 2.7GB |
| Qwen3-ASR 0.6B (Q8_0) | 1.4GB |
| parakeet-tdt_ctc-0.6b-ja (F16) | 1.3GB |
| ReazonSpeech NeMo v2 (F16) | 1.3GB |
| parakeet-tdt-0.6b-v3 (F16) | 1.3GB |
| Irodori-TTS v4.1-Small-MF (F16) | 2.1GB |
| Qwen3-TTS 0.6B (Q8_0) | 1.3GB |
| Qwen3-TTS 1.7B (Q8_0) | 2.7GB |

The Windows desktop and ASIST with the microphone off use the same GPU memory as well, 1.64GB at the time of the measurement. Adding the values of the table to it, 1.7B speech recognition comes to about 6.4GB with Irodori-TTS, about 5.6GB with 0.6B Qwen3-TTS, and about 7.0GB with 1.7B Qwen3-TTS. This is why ASIST recommends 1.7B for speech recognition with 6GB of GPU memory or more, and the first-time setup also recommends Irodori-TTS and Qwen3-TTS with 8GB or more. Below 6GB, it recommends 0.6B for speech recognition. The 1.7B size of Qwen3-TTS can be chosen with 10GB of GPU memory or more.

Searching the memory by meaning, choosing the kind of backchannel and detecting the end of a turn run on the CPU and the main memory on Windows as well. Their memory use on Windows has not been measured yet.
