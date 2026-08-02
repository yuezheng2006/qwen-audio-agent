# Cascade input audio fixtures

16 kHz mono PCM16 WAV used by automated cascade session tests.

| File | Purpose |
| --- | --- |
| `utterance_a.wav` | One voiced turn + trailing silence (VAD commit) |
| `utterance_b.wav` | Second turn / barge-in |
| `near_silence.wav` | Below VAD threshold — must not start a turn |
| `soft_onset.wav` | Quiet lead-in then speech — preroll must reach STT |

Generated synthetically (tones + silence), not real speech recordings.
