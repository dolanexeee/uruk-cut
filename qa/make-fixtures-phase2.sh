#!/usr/bin/env bash
# Phase-2 fixtures: short SPEECH videos + a music bed.
#
#  speech-en.mp4 — English speech synthesized LOCALLY by FFmpeg's libflite
#                  voice "slt": "Welcome to Uruk Cut. This is a caption test."
#                  (expected STT keywords: "welcome", "caption")
#  speech-ar.mp4 — Arabic speech synthesized by the Google Translate TTS
#                  endpoint (female voice), text:
#                  "مرحبًا بكم في أوروك كت. هذا اختبار للترجمة التلقائية."
#                  ("Welcome to Uruk Cut. This is an automatic captioning test.")
#                  Microsoft Edge TTS was attempted first but its WSS endpoint
#                  is blocked by this sandbox's egress proxy (handshake 101);
#                  the Google endpoint is plain HTTPS and works. The raw voice
#                  is 6.67 s and is sped up with atempo=1.2 to fit the 6 s clip.
#  music.wav     — 10 s four-note sine bed (440/554/659/523 Hz), generated.
#
# Both speech clips: 640x360 testsrc2 video, speech starts at 0.3 s, total 6 s.
set -euo pipefail
cd "$(dirname "$0")/fixtures"
FFMPEG="${FFMPEG:-ffmpeg}"

# --- English (flite) ---
"$FFMPEG" -y -hide_banner -loglevel error \
  -f lavfi -i "flite=text='Welcome to Uruk Cut. This is a caption test.':voice=slt" \
  -ar 44100 /tmp/uruk-en-voice.wav
"$FFMPEG" -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=duration=6:size=640x360:rate=30" \
  -i /tmp/uruk-en-voice.wav \
  -filter_complex "[1:a]adelay=300|300,apad=whole_dur=6[a]" \
  -map 0:v -map "[a]" -t 6 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k \
  speech-en.mp4

# --- Arabic (Google Translate TTS endpoint, plain HTTPS) ---
AR_TEXT="مرحبًا بكم في أوروك كت. هذا اختبار للترجمة التلقائية."
AR_Q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$AR_TEXT")
curl -s --max-time 60 \
  -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" \
  "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ar&q=${AR_Q}" \
  -o /tmp/uruk-ar-voice.mp3
"$FFMPEG" -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=duration=6:size=640x360:rate=30" \
  -i /tmp/uruk-ar-voice.mp3 \
  -filter_complex "[1:a]atempo=1.2,adelay=200|200,apad=whole_dur=6[a]" \
  -map 0:v -map "[a]" -t 6 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k \
  speech-ar.mp4

# --- Music bed (generated tones) ---
"$FFMPEG" -y -hide_banner -loglevel error \
  -f lavfi -i "sine=frequency=440:duration=2.5" \
  -f lavfi -i "sine=frequency=554:duration=2.5" \
  -f lavfi -i "sine=frequency=659:duration=2.5" \
  -f lavfi -i "sine=frequency=523:duration=2.5" \
  -filter_complex "[0:a][1:a][2:a][3:a]concat=n=4:v=0:a=1,volume=15dB,alimiter=limit=0.9[a]" \
  -map "[a]" -ar 44100 music.wav

for f in speech-en.mp4 speech-ar.mp4 music.wav; do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  echo "$f  duration=$d"
done
