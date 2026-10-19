/** Answer-independent timing for microphone capture; all audio stays local. */
export const SPEECH_ENDPOINT_TIMING = Object.freeze({
  noSpeechMs: 10_000,
  trailingSilenceMs: 2_000,
  minimumActivityMs: 160,
  maximumRecordingMs: 45_000,
});

const FRAME_MS = 20;
// A modest energy gate rejects the microphone's quiet background floor. ASR
// evidence also opens the gate, so a quiet voice need not exceed this level.
const ACTIVE_RMS = 0.01;

/**
 * PCM activity determines the endpoint, never the expected digits or their count.
 * A caller may corroborate quiet speech with a changed, nonempty ASR hypothesis.
 * Repeated unchanged hypotheses must not be passed as new speech evidence.
 */
export class SpeechEndpoint {
  private readonly sampleRate: number;
  private readonly frameSamples: number;
  private elapsedSamples = 0;
  private frameCount = 0;
  private frameSum = 0;
  private framePower = 0;
  private consecutiveActivity = 0;
  private lastActivity = 0;
  private heardSpeech = false;
  private ended = false;

  constructor(sampleRate = 16_000) {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("A positive speech sample rate is required.");
    this.sampleRate = sampleRate;
    this.frameSamples = Math.max(1, Math.round(sampleRate * FRAME_MS / 1000));
  }

  get hasSpeech(): boolean { return this.heardSpeech; }

  confirmSpeech(): void {
    if (this.ended) return;
    this.heardSpeech = true;
    this.lastActivity = this.elapsedSamples;
  }

  /** Returns true only once, after a complete trailing interval of quiet PCM. */
  push(samples: Float32Array): boolean {
    if (this.ended) return false;
    for (const sample of samples) {
      this.elapsedSamples += 1;
      this.frameCount += 1;
      this.frameSum += sample;
      this.framePower += sample * sample;
      if (this.frameCount < this.frameSamples) continue;
      // Remove DC bias: a stuck or offset microphone signal is not speech.
      const mean = this.frameSum / this.frameCount;
      const rms = Math.sqrt(Math.max(0, this.framePower / this.frameCount - mean * mean));
      if (rms >= ACTIVE_RMS) {
        this.consecutiveActivity += this.frameCount;
        if (this.consecutiveActivity >= this.sampleRate * SPEECH_ENDPOINT_TIMING.minimumActivityMs / 1000) this.heardSpeech = true;
        if (this.heardSpeech) this.lastActivity = this.elapsedSamples;
      } else {
        this.consecutiveActivity = 0;
      }
      this.frameCount = 0;
      this.frameSum = 0;
      this.framePower = 0;
      if (this.heardSpeech && this.elapsedSamples - this.lastActivity >= this.sampleRate * SPEECH_ENDPOINT_TIMING.trailingSilenceMs / 1000) {
        this.ended = true;
        return true;
      }
    }
    return false;
  }
}
