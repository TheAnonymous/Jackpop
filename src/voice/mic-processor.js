// AudioWorklet of the coin slot: copies the microphone off the audio thread
// while recording. A plain file, so the build emits it as a same-origin asset
// that the site's CSP (scripts only from 'self') allows.
/* global AudioWorkletProcessor, registerProcessor, currentTime */
class CoinSlotRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 4096;
    this.chunk = new Float32Array(this.size);
    this.filled = 0;
    this.recording = false;
    this.started = false;
    this.port.onmessage = (event) => {
      if (event.data === "start") {
        this.recording = true;
        this.started = false;
        this.filled = 0;
      } else if (event.data === "stop") {
        if (this.filled > 0) this.port.postMessage({ samples: this.chunk.slice(0, this.filled) });
        this.filled = 0;
        this.recording = false;
        this.port.postMessage({ done: true });
      }
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!this.recording || !channel) return true;
    if (!this.started) {
      this.started = true;
      // The audio-clock time of the first recorded sample.
      this.port.postMessage({ start: currentTime });
    }
    for (let index = 0; index < channel.length; index += 1) {
      this.chunk[this.filled] = channel[index];
      this.filled += 1;
      if (this.filled === this.size) {
        this.port.postMessage({ samples: this.chunk }, [this.chunk.buffer]);
        this.chunk = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("jackpop-coin-slot", CoinSlotRecorder);
