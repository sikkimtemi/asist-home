---
title: Models ASIST uses
description: The models that run on this computer, and the models called over an API.
sidebar:
  order: 1
---

## Models that run on this computer

Everything that is downloaded is pinned to a version and a sha256.

| Use | Model | Source | License |
|---|---|---|---|
| Speech recognition (recommended on a Mac with 16GB of memory or more, and on Windows with 6GB of dedicated GPU memory or more) | Qwen3-ASR 1.7B (GGUF, Q8_0) | `sakasegawa/Qwen3-ASR-1.7B-GGUF` (converted from the model Qwen published) | Apache-2.0 |
| Speech recognition (Japanese, explicitly selected) | Haas-ja-v1.0 (GGUF, Q8_0) | `sakasegawa/Haas-ja-v1.0-GGUF` (converted from Third Intelligence’s model) | Apache-2.0 |
| Speech recognition (recommended with less memory or an integrated Windows GPU) | Qwen3-ASR 0.6B (GGUF, Q8_0) | `sakasegawa/Qwen3-ASR-0.6B-GGUF` (converted from the model Qwen published) | Apache-2.0 |
| Speech recognition (Japanese, only when chosen) | parakeet-tdt_ctc-0.6b-ja (GGUF, Q8_0) | `sakasegawa/parakeet-tdt_ctc-0.6b-ja-GGUF` (converted from the model NVIDIA published) | CC BY 4.0 |
| Speech recognition (Japanese, only when chosen) | ReazonSpeech NeMo v2 (GGUF, Q8_0) | `sakasegawa/reazonspeech-nemo-v2-GGUF` (converted from reazonspeech-nemo-v2, which Reazon Human Interaction Lab published) | Apache-2.0 |
| Speech recognition (English, French, German, Italian, Portuguese and Spanish, only when chosen) | parakeet-tdt-0.6b-v3 (GGUF, F16) | `sakasegawa/parakeet-tdt-0.6b-v3-GGUF` (converted from the model NVIDIA published) | CC BY 4.0 |
| Speech recognition (in the browser, as a backup) | Whisper small (ONNX, transformers.js) | `onnx-community/whisper-small` | MIT (OpenAI Whisper) |
| Voice activity detection | Silero VAD (ONNX, bundled) | Bundled | MIT |
| Microphone noise suppression | DeepFilterNet3 (ONNX, bundled) | Bundled | MIT or Apache-2.0 |
| Reading aloud (the default for Japanese) | Irodori-TTS v4.1-Small-MF (GGUF, F16). The same file holds Semantic-DACVAE-Japanese-32dim, the decoder that turns its output into audio. Three voices | `sakasegawa/Irodori-TTS-v4.1-Small-MF-GGUF` (converted from the model Aratako published) | MIT (facebook/dacvae-watermarked, which the decoder derives from, is Apache-2.0) |
| Reading aloud | Qwen3-TTS 12Hz CustomVoice 0.6B and 1.7B (GGUF, Q8_0), one file for each size with its audio decoder inside. Nine voices | `sakasegawa/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF` and `sakasegawa/Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF` (converted from the models Qwen published) | Apache-2.0 |
| End of turn and backchannel timing (MaAI, Japanese) | `vap_jp_kyoto`, `bc_det_jp`, `vap_bc_2type_jp` and `vap_nod_jp` from the MaAI team at Kyoto University. The encoder is Mimi from kyutai, and the CPC pretrained weights are from facebookresearch/CPC_audio | `maai-kyoto` on Hugging Face, `dl.fbaipublicfiles.com` | MIT (Mimi is CC BY 4.0) |
| Choosing the kind of backchannel (Japanese) | sbintuitions/modernbert-ja-70m fine-tuned on synthetic data (ONNX int8) | [sakasegawa/modernbert-ja-70m-aizuchi](https://huggingface.co/sakasegawa/modernbert-ja-70m-aizuchi) | MIT |
| Searching the memory by meaning | multilingual-e5 small (ONNX int8) | `Xenova/multilingual-e5-small` (converted from `intfloat/multilingual-e5-small`) | MIT |

Qwen3-ASR and the four FastConformer models (parakeet-tdt_ctc-0.6b-ja, ReazonSpeech NeMo v2, parakeet-tdt-0.6b-v3 and Haas-ja-v1.0) for speech recognition, and Irodori-TTS and Qwen3-TTS for reading aloud, run in speech.cpp, which is bundled with the app. They use the GPU through Metal on a Mac and through Vulkan on Windows. The downloads are about 2.2GB for Qwen3-ASR 1.7B, about 0.8GB for 0.6B, about 0.66GB each for parakeet-tdt_ctc-0.6b-ja, ReazonSpeech NeMo v2 and Haas-ja-v1.0, about 1.3GB for parakeet-tdt-0.6b-v3, about 1.9GB for Irodori-TTS, about 1.2GB for Qwen3-TTS 0.6B and about 2.3GB for 1.7B. The bundled programs are listed in [What is bundled](/en/docs/reference/bundled/).

Qwen3-ASR recognizes all 11 of ASIST's conversation languages. The four FastConformer models recognize fewer. Haas-ja-v1.0, parakeet-tdt_ctc-0.6b-ja and ReazonSpeech NeMo v2 recognize Japanese only. parakeet-tdt-0.6b-v3 recognizes 25 European languages, which among the conversation languages are English, French, German, Italian, Portuguese and Spanish. Korean, Hindi and Indonesian are recognized by Qwen3-ASR alone. When the model is chosen automatically, it is Qwen3-ASR; a FastConformer model is used only when you choose it on the "Voice" page of the settings. On sentences read aloud in Japanese (the 4,483 clips of Common Voice 8.0), parakeet-tdt_ctc-0.6b-ja made fewer errors than Qwen3-ASR 1.7B and was faster. They have not yet been compared on everyday conversation.

Speech recognition, MaAI and the model that chooses the kind of backchannel are loaded only while the conversation's microphone is on, and stop when it is turned off. Irodori-TTS and Qwen3-TTS load when the microphone is turned on and whenever something is to be read aloud. Once the microphone is off, they stop after 5 minutes in which nothing was read aloud, and while the window is closed or minimized, as soon as the reply being read has ended. Stopping them frees memory on a Mac and GPU memory on Windows. Loading them again takes 3 seconds at most while the files are still in the system's cache, and is usually done before the first reply after turning the microphone on is read aloud. With Gemini Live as the voice engine, none of them is loaded.

The model card of Irodori-TTS forbids copying or impersonating a voice without the person's consent, and making deepfakes or misinformation. The three voices of ASIST were made by giving Irodori-TTS a description of each voice, and are not the voices of real people.

For reading aloud, you can also use the system's voice ("macOS voice" or "Windows voice"), or VOICEVOX and AivisSpeech, which run as separate apps. The VOICEVOX and AivisSpeech voices each have their own terms of use.

## Models called over an API

| Use | Model | Provider |
|---|---|---|
| Conversation, bridge phrase, history summary | Claude Sonnet 5, Claude Haiku 4.5, Claude Opus 5 | Anthropic |
| Same as above | GPT-5.6 Luna, GPT-5.6 Terra, GPT-6 Luna, GPT-6.1 Terra | OpenAI |
| Same as above | The models above that your account offers (on a ChatGPT plan) | ChatGPT (OpenAI) |
| Same as above | Gemini 3.8 Flash, Gemini 3.5 Flash Lite | Google |
| Same as above | Qwen 3.8 27B, GPT OSS 120B | Cerebras |
| Voice engine | `gemini-3.8-live`, `gemini-3.8-live-extended-thinking` | Google |

The list of models you can choose for the conversation, and the default, is in [llm-catalog.ts](https://github.com/sikkimtemi/asist-home/blob/main/src/shared/llm-catalog.ts). The codex and claude CLIs decide which models Agent jobs and memory curation use.
