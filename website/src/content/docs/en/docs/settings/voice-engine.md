---
title: Voice engine
description: Listen and speak on this computer, or leave it to Gemini Live.
sidebar:
  order: 5
---

Under "Voice engine" in "Conversation", choose what listens and speaks. The default combines speech recognition on this computer, the conversation model, and reading aloud on this computer.

When you choose "Speech recognition on this computer + model + speech" and the speech recognition or the speech doesn't work yet, it shows under "Needs preparing" on "Overview" and next to "Voice" in the list of pages. If you chose "Talk in real time with a voice model" or "Text only" in the first setup, it skipped preparing both. Prepare speech recognition with "Prepare" under "Speech recognition" on the "Voice" page; until then the microphone can't be used. When the speech engine is "No speech (replies as text only)", replies appear as text only. To hear them, choose an engine under "Speech" on the "Voice" page.

Choose the speech recognition model under "Model" in "Speech recognition" on the "Voice" page. "Automatic (by installed memory)" on a Mac and "Automatic (by GPU memory)" on Windows use Qwen3-ASR 1.7B or 0.6B, whichever fits the memory. The list shows only the models that recognize the conversation language, each with the size it downloads. In Japanese you can also choose Haas-ja-v1.0, parakeet-tdt_ctc-0.6b-ja and ReazonSpeech NeMo v2, and in English, French, German, Italian, Portuguese and Spanish, parakeet-tdt-0.6b-v3. Download a model you chose with "Prepare" on its row. If you change the conversation language to one the chosen model doesn't recognize, the model goes back to the automatic choice. The languages and sizes of each model are in [Models ASIST uses](/en/docs/reference/models/), and their memory in [Memory requirements](/en/docs/reference/memory/).

Speech recognition also works on integrated Vulkan GPUs on Windows. Automatic selection uses Qwen3-ASR 0.6B on integrated graphics. To use Haas, set the conversation language to Japanese, choose Haas-ja-v1.0 under "Model", and click "Prepare". The Q8_0 file is about 0.66 GB. Irodori-TTS and Qwen3-TTS still require a discrete GPU on Windows; use Windows voice, VOICEVOX or AivisSpeech on a PC with integrated graphics alone.

Long utterances are split at pauses into parts of at most 10 seconds for local recognition, then joined into one transcript. A part without a pause is cut at 10 seconds. This does not change how ASIST decides when you finish speaking or interrupt.

When you choose Gemini Live, the microphone audio goes straight to Google, and ASIST speaks in Google's voice. The model handles backchannels, listening, and deciding when you have finished speaking or interrupted. Speech recognition and reading aloud on this computer, the bridge phrase and MaAI are not used, so you can talk by voice even on Windows without a discrete GPU. Changing the engine, "Model", "Voice" or "Close the session after" turns the microphone off, so turn it on again.

Gemini decides by itself and calls ASIST's tools. ASIST runs the tools, so the confirmation screen for writes still appears. The conversation model is not used. It needs a Google API key, and costs about $0.005 per minute of audio input and $0.018 per minute of output.

A session opens when you start talking, and closes once the conversation has stopped for the time set in "Close the session after" (90 seconds by default). You aren't charged while it is closed. When you speak again, ASIST holds the last 3 seconds of audio while it reopens the session, so the start of what you say isn't lost. With "Show at the top of the screen" turned on in [Appearance](/en/docs/settings/appearance/), the top of the screen shows the connection, the time to respond, the minutes in the session and the estimated cost. Turning the microphone off closes the session.

Choose a voice on the "Voice" page from the ones Google offers, and use "Play sample" to hear a bundled sample. Playing a sample doesn't use the API.

With Gemini Live, the conversation log records transcripts of the input and the output as they were actually heard. Memory curation works from this log, so it works from the same material whichever engine you use.

![The Conversation page in the settings, with the voice engine and the models](/screens/en/settings-conversation.webp)
