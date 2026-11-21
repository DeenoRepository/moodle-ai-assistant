// Runs in an offscreen document, where AudioContext is available (the service worker has no audio APIs).
// Takes a video file's bytes, decodes only its audio track, and returns 16 kHz mono 16-bit WAV as base64.
// The video frames are never rendered, so nothing visual is sent to the model.

const TARGET_SAMPLE_RATE = 16000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen" || message.action !== "extractAudio") return false;
  extractAudio(message.bytes)
    .then((base64) => sendResponse({ ok: true, data: base64 }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function extractAudio(byteArray) {
  const audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    const decoded = await audioContext.decodeAudioData(new Uint8Array(byteArray).buffer);
    const mono = mixToMono(decoded);
    const wav = encodeWav(mono, TARGET_SAMPLE_RATE);
    return bytesToBase64(new Uint8Array(wav));
  } finally {
    await audioContext.close();
  }
}

function mixToMono(audioBuffer) {
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }
  return mono;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }
  return buffer;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
