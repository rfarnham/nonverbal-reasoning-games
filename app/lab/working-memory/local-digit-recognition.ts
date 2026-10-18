/** Local-only digit ASR. Model/runtime are requested only by prepare(). */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SPEECH_ROOT = `${BASE_PATH}/models/speech`;
export const LOCAL_SPEECH_DOWNLOAD_MB = 46;
export const DIGIT_GRAMMAR = Object.freeze([
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "[unk]",
]);
const DIGITS: Readonly<Record<string, number>> = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
});
const SAMPLE_RATE = 16000;
const MAX_SECONDS = 45;

export interface LocalDigitResult {
  digits: number[];
  transcript: string;
  status: "recognized" | "uncertain";
}
export interface LocalSpeechProgress {
  phase: "loading" | "ready";
  downloadMB: number;
}
interface Word {
  word: string;
  conf: number;
}
interface Segment {
  text?: string;
  result?: Word[];
}
interface WorkerReply {
  event: "load" | "error" | "result" | "partialresult" | "finalresult";
  result?: boolean | Segment;
  recognizerId?: string;
  error?: string;
}
interface Recording {
  id: string;
  segments: Segment[];
  samples: number;
  stream: MediaStream | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  gain: GainNode | null;
  timer: ReturnType<typeof setTimeout> | null;
  flush: (() => void) | null;
  resolve: ((value: LocalDigitResult) => void) | null;
  reject: ((error: Error) => void) | null;
  finishing: boolean;
}

function aborted(): Error {
  return new DOMException("Speech input cancelled.", "AbortError");
}

/** Reject unknown words/weak results rather than silently guessing an answer. */
export function parseLocalDigitResult(segments: readonly Segment[]): LocalDigitResult {
  const transcript = segments.map((segment) => segment.text?.trim() ?? "").filter(Boolean).join(" ");
  const tokens = transcript.toLowerCase().split(/\s+/).filter(Boolean);
  const words = segments.flatMap((segment) => segment.result ?? []);
  const digits = tokens.map((token) => DIGITS[token]);
  const confidences = words.map((word) => word.conf);
  const valid = tokens.length > 0 && tokens.length <= 12
    && digits.every((digit) => digit !== undefined)
    && words.length === tokens.length
    && words.every((word, index) => typeof word.word === "string" && word.word.toLowerCase() === tokens[index])
    && confidences.every((confidence) => Number.isFinite(confidence) && confidence >= 0.65)
    && confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length >= 0.8;
  return { digits: valid ? digits : [], transcript, status: valid ? "recognized" : "uncertain" };
}

export function localDigitRecognitionSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext
    && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined"
    && typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia);
}

export class LocalDigitRecognizer {
  private worker: Worker | null = null;
  private prepared = false;
  private preparing: Promise<void> | null = null;
  private prepareResolve: (() => void) | null = null;
  private prepareReject: ((error: Error) => void) | null = null;
  private prepareTimer: ReturnType<typeof setTimeout> | null = null;
  private current: Recording | null = null;
  private generation = 0;
  private sequence = 0;
  private onError?: (error: Error) => void;

  constructor(options: { onError?: (error: Error) => void } = {}) {
    this.onError = options.onError;
  }

  get ready(): boolean { return this.prepared; }
  get recording(): boolean { return this.current !== null && !this.current.finishing; }

  async prepare(onProgress?: (progress: LocalSpeechProgress) => void): Promise<void> {
    if (this.prepared) { onProgress?.({ phase: "ready", downloadMB: LOCAL_SPEECH_DOWNLOAD_MB }); return; }
    if (this.preparing) return this.preparing;
    if (!localDigitRecognitionSupported()) throw new Error("Local speech input is unavailable in this browser. Use the keypad.");
    onProgress?.({ phase: "loading", downloadMB: LOCAL_SPEECH_DOWNLOAD_MB });
    const workerUrl = new URL(`${SPEECH_ROOT}/vosk-worker-v0.0.8.js`, window.location.origin);
    const modelUrl = new URL(`${SPEECH_ROOT}/vosk-model-small-en-us-0.15.tar.gz`, window.location.origin);
    if (workerUrl.origin !== window.location.origin || modelUrl.origin !== window.location.origin) {
      throw new Error("Speech assets must stay on this site.");
    }
    this.preparing = new Promise<void>((resolve, reject) => {
      this.prepareResolve = resolve;
      this.prepareReject = reject;
      this.prepareTimer = setTimeout(() => this.failWorker(new Error("Local speech loading took too long. Try again or use the keypad.")), 180_000);
      try {
        this.worker = new Worker(workerUrl);
        const worker = this.worker;
        this.worker.onmessage = (event: MessageEvent<WorkerReply>) => { if (this.worker === worker) this.receive(event.data); };
        this.worker.onerror = (event) => {
          event.preventDefault();
          if (this.worker === worker) this.failWorker(new Error("Local speech could not run on this device. Use the keypad."));
        };
        this.worker.onmessageerror = () => {
          if (this.worker === worker) this.failWorker(new Error("Local speech could not read its result. Try again or use the keypad."));
        };
        this.worker.postMessage({ action: "set", key: "logLevel", value: -2 });
        this.worker.postMessage({ action: "load", modelUrl: modelUrl.href });
      } catch { this.failWorker(new Error("Local speech could not start. Use the keypad.")); }
    });
    try {
      await this.preparing;
      onProgress?.({ phase: "ready", downloadMB: LOCAL_SPEECH_DOWNLOAD_MB });
    } finally { this.preparing = null; }
  }

  private receive(message: WorkerReply | undefined): void {
    // Upstream recognizer creation acknowledges with an empty message.
    if (!message) return;
    if (message.event === "load") {
      if (!message.result) { this.failWorker(new Error("Local speech model could not load. Try again or use the keypad.")); return; }
      this.prepared = true;
      if (this.prepareTimer) clearTimeout(this.prepareTimer);
      this.prepareTimer = null;
      this.prepareReject = null;
      this.prepareResolve?.();
      this.prepareResolve = null;
      return;
    }
    const current = this.current;
    if (message.event === "error") {
      if (!message.recognizerId) this.failWorker(new Error("Local speech stopped. Try again or use the keypad."));
      else if (message.recognizerId === current?.id) this.failRecording(new Error("Speech recognition stopped. Record again or use the keypad."));
      return;
    }
    if (!current || message.recognizerId !== current.id || !message.result || typeof message.result !== "object") return;
    if (message.event === "result" || message.event === "finalresult") current.segments.push(message.result);
    if (message.event === "finalresult" && current.finishing) {
      const result = parseLocalDigitResult(current.segments);
      current.resolve?.(result);
      current.resolve = null;
      current.reject = null;
      this.clearRecording(current);
    }
  }

  private createRecording(): Recording {
    if (!this.prepared || !this.worker) throw new Error("Set up local speech before recording.");
    if (this.current) throw new Error("Speech input is already active.");
    const current: Recording = {
      id: `digits-${++this.sequence}`, segments: [], samples: 0, stream: null,
      context: null, source: null, worklet: null, gain: null, timer: null,
      flush: null, resolve: null, reject: null, finishing: false,
    };
    this.current = current;
    try {
      this.worker.postMessage({ action: "create", recognizerId: current.id, sampleRate: SAMPLE_RATE, grammar: JSON.stringify(DIGIT_GRAMMAR) });
      this.worker.postMessage({ action: "set", recognizerId: current.id, key: "words", value: true });
    } catch {
      this.current = null;
      throw new Error("Local speech stopped. Set it up again or use the keypad.");
    }
    return current;
  }

  async start(): Promise<void> {
    const generation = this.generation;
    const current = this.createRecording();
    try {
      // Resume synchronously from the recording gesture, before permission awaits.
      current.context = new AudioContext();
      const resumed = current.context.resume();
      // Permission can outlive a failed resume; attach a handler immediately.
      void resumed.catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (this.current !== current || generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); throw aborted(); }
      current.stream = stream;
      await resumed;
      await current.context.audioWorklet.addModule(`${SPEECH_ROOT}/digit-capture.worklet.js`);
      if (this.current !== current || generation !== this.generation) throw aborted();
      current.worklet = new AudioWorkletNode(current.context, "digit-capture", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      current.worklet.port.onmessage = (event: MessageEvent<{ type: string; samples?: Float32Array }>) => {
        if (this.current !== current) return;
        if (event.data.type === "flushed") { current.flush?.(); current.flush = null; return; }
        const samples = event.data.samples;
        if (event.data.type === "samples" && samples instanceof Float32Array) this.sendSamples(current, samples);
      };
      current.source = current.context.createMediaStreamSource(stream);
      current.gain = current.context.createGain();
      current.gain.gain.value = 0;
      current.source.connect(current.worklet);
      current.worklet.connect(current.gain);
      current.gain.connect(current.context.destination);
      stream.getAudioTracks().forEach((track) => track.addEventListener("ended", () => {
        if (this.current === current && !current.finishing) this.failRecording(new Error("The microphone stopped. Record again or use the keypad."));
      }, { once: true }));
      current.timer = setTimeout(() => this.failRecording(new Error("Recording stopped after 45 seconds. Record again or use the keypad.")), MAX_SECONDS * 1000);
    } catch (error) {
      if (this.current === current) this.clearRecording(current);
      throw error;
    }
  }

  private sendSamples(current: Recording, samples: Float32Array): void {
    if (this.current !== current) return;
    current.samples += samples.length;
    if (current.samples > SAMPLE_RATE * MAX_SECONDS) { this.failRecording(new Error("The recording was too long. Record again or use the keypad.")); return; }
    // Vosk's native float input uses the int16 amplitude scale, unlike WebAudio.
    const data = samples.map((value) => value * 32768);
    this.worker?.postMessage({ action: "audioChunk", recognizerId: current.id, data, sampleRate: SAMPLE_RATE }, [data.buffer]);
  }

  async stop(): Promise<LocalDigitResult> {
    const current = this.current;
    if (!current || current.finishing) throw new Error("No speech recording is active.");
    current.finishing = true;
    if (current.timer) clearTimeout(current.timer);
    current.stream?.getTracks().forEach((track) => track.stop());
    current.source?.disconnect();
    try {
      if (current.worklet) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("The microphone could not finish recording. Record again or use the keypad.")), 2000);
          current.flush = () => { clearTimeout(timer); resolve(); };
          try { current.worklet?.port.postMessage({ action: "flush" }); }
          catch { clearTimeout(timer); reject(new Error("The microphone stopped. Record again or use the keypad.")); }
        });
      }
    } catch (error) {
      if (this.current === current) this.clearRecording(current);
      throw error;
    }
    if (this.current !== current) throw aborted();
    this.closeAudio(current);
    return this.finish(current);
  }

  /** Same recognizer used by microphone input; accepts arbitrary offline audio. */
  async recognize(samples: Float32Array, sampleRate: number): Promise<LocalDigitResult> {
    if (sampleRate !== SAMPLE_RATE || !samples.length || samples.length > SAMPLE_RATE * MAX_SECONDS
      || !samples.every((value) => Number.isFinite(value) && Math.abs(value) <= 1)) {
      throw new Error("Speech audio must be finite 16 kHz mono PCM, at most 45 seconds.");
    }
    const current = this.createRecording();
    for (let offset = 0; offset < samples.length; offset += 4096) this.sendSamples(current, samples.slice(offset, offset + 4096));
    current.finishing = true;
    return this.finish(current);
  }

  private finish(current: Recording): Promise<LocalDigitResult> {
    return new Promise((resolve, reject) => {
      current.resolve = resolve;
      current.reject = reject;
      current.timer = setTimeout(() => this.failRecording(new Error("Local speech took too long. Record again or use the keypad.")), 30_000);
      try { this.worker?.postMessage({ action: "retrieveFinalResult", recognizerId: current.id }); }
      catch { this.clearRecording(current); reject(new Error("Local speech stopped. Record again or use the keypad.")); }
    });
  }

  private closeAudio(current: Recording): void {
    current.stream?.getTracks().forEach((track) => track.stop());
    current.source?.disconnect();
    current.worklet?.disconnect();
    current.gain?.disconnect();
    if (current.worklet) current.worklet.port.onmessage = null;
    current.worklet?.port.close();
    if (current.context && current.context.state !== "closed") void current.context.close().catch(() => {});
    current.stream = null;
    current.source = null;
    current.worklet = null;
    current.gain = null;
    current.context = null;
  }

  private clearRecording(current: Recording): void {
    if (this.current === current) this.current = null;
    if (current.timer) clearTimeout(current.timer);
    current.flush?.();
    current.flush = null;
    this.closeAudio(current);
    try { this.worker?.postMessage({ action: "remove", recognizerId: current.id }); } catch { /* Worker may already have stopped. */ }
  }

  private failRecording(error: Error, notify = true): void {
    const current = this.current;
    if (!current) return;
    const wasFinishing = current.finishing;
    current.reject?.(error);
    this.clearRecording(current);
    if (notify && !wasFinishing) this.onError?.(error);
  }

  private failWorker(error: Error): void {
    // A warmed worker can fail while idle, so readiness notification must not
    // depend on a live recording. Set readiness before notifying the consumer.
    const notify = this.prepared && error.name !== "AbortError";
    this.prepared = false;
    this.prepareReject?.(error);
    this.prepareReject = null;
    this.prepareResolve = null;
    if (this.prepareTimer) clearTimeout(this.prepareTimer);
    this.prepareTimer = null;
    this.failRecording(error, false);
    this.worker?.terminate();
    this.worker = null;
    if (notify) this.onError?.(error);
  }

  cancel(): void {
    this.generation += 1;
    const current = this.current;
    if (!current) return;
    current.reject?.(aborted());
    this.clearRecording(current);
  }

  dispose(): void {
    this.cancel();
    this.failWorker(aborted());
  }
}
