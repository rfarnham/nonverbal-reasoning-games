/* Microphone PCM stays in this audio graph and the local recognition worker. */
class DigitCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.length = 0;
    this.sum = 0;
    this.weight = 0;
    this.remaining = sampleRate / 16000;
    this.active = true;
    this.port.onmessage = (event) => {
      if (event.data?.action !== "flush") return;
      this.active = false;
      this.flush();
      this.port.postMessage({ type: "flushed" });
    };
  }

  flush() {
    if (!this.length) return;
    const samples = this.buffer.slice(0, this.length);
    this.port.postMessage({ type: "samples", samples }, [samples.buffer]);
    this.length = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!this.active || !channels?.length) return true;
    const ratio = sampleRate / 16000;
    for (let frame = 0; frame < channels[0].length; frame += 1) {
      let value = 0;
      for (const channel of channels) value += channel[frame] / channels.length;
      // A weighted box filter keeps chunk boundaries continuous when device
      // sample rates (usually 44.1/48 kHz) are not integral multiples of 16 kHz.
      let available = 1;
      while (available > 1e-9) {
        const used = Math.min(available, this.remaining);
        this.sum += value * used;
        this.weight += used;
        this.remaining -= used;
        available -= used;
        if (this.remaining < 1e-9) {
          this.buffer[this.length++] = this.sum / this.weight;
          this.sum = 0;
          this.weight = 0;
          this.remaining = ratio;
          if (this.length === this.buffer.length) this.flush();
        }
      }
    }
    return true;
  }
}

registerProcessor("digit-capture", DigitCaptureProcessor);
