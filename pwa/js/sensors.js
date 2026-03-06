export class SensorHub {
  constructor(onSample) {
    this.onSample = onSample;
    this.device = null;
    this.characteristic = null;
    this.ppgStream = null;
    this.ppgTimer = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.redSeries = [];
    this.lastHrEmit = 0;
  }

  async connectBLE() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth not supported in this browser.');

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
      optionalServices: ['battery_service'],
    });

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    this.characteristic = await service.getCharacteristic('heart_rate_measurement');

    await this.characteristic.startNotifications();
    this.characteristic.addEventListener('characteristicvaluechanged', (event) => {
      const value = event.target.value;
      const flags = value.getUint8(0);
      const is16Bit = (flags & 0x1) !== 0;
      const hasRR = (flags & 0x10) !== 0;

      const hr = is16Bit ? value.getUint16(1, true) : value.getUint8(1);
      const rrIntervals = [];

      if (hasRR) {
        let offset = is16Bit ? 3 : 2;
        while (offset + 1 < value.byteLength) {
          const rr1024 = value.getUint16(offset, true);
          rrIntervals.push((rr1024 / 1024) * 1000);
          offset += 2;
        }
      }

      this.onSample({
        source: 'ble',
        ts: performance.now(),
        hr,
        rrIntervals,
        pulseStrength: null,
      });
    });

    return `Connected to ${this.device.name || 'heart rate device'}`;
  }

  async connectCameraPPG() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is not supported in this browser.');
    }

    this.ppgStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });

    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.ppgStream;
    await this.video.play();

    this.canvas = document.createElement('canvas');
    this.canvas.width = 96;
    this.canvas.height = 96;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.redSeries = [];
    this.lastHrEmit = 0;

    this.ppgTimer = setInterval(() => {
      if (!this.video || !this.ctx) return;
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const frame = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;

      let red = 0;
      let green = 0;
      for (let i = 0; i < frame.length; i += 4) {
        red += frame[i];
        green += frame[i + 1];
      }
      const n = frame.length / 4;
      const redAvg = red / n;
      const greenAvg = green / n;
      const pulseStrength = Math.max(0, Math.min(100, (redAvg - greenAvg + 40) * 1.6));

      const ts = performance.now();
      this.redSeries.push({ ts, v: redAvg });
      const horizon = ts - 12000;
      this.redSeries = this.redSeries.filter((s) => s.ts >= horizon);

      if (ts - this.lastHrEmit > 950) {
        const hr = this.estimatePpgHeartRate(this.redSeries);
        if (hr) {
          this.onSample({ source: 'camera', ts, hr, rrIntervals: [60000 / hr], pulseStrength });
        }
        this.lastHrEmit = ts;
      }
    }, 33);

    return 'Camera PPG connected. Place finger on lens + flash for stronger signal.';
  }

  estimatePpgHeartRate(series) {
    if (series.length < 80) return null;
    const values = series.map((s) => s.v);
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    const centered = values.map((v, i) => ({ ts: series[i].ts, v: v - m }));

    const smooth = [];
    for (let i = 2; i < centered.length - 2; i += 1) {
      const val =
        (centered[i - 2].v + centered[i - 1].v + centered[i].v + centered[i + 1].v + centered[i + 2].v) / 5;
      smooth.push({ ts: centered[i].ts, v: val });
    }

    if (smooth.length < 20) return null;
    const amps = smooth.map((s) => s.v);
    const sd = Math.sqrt(amps.reduce((acc, x) => acc + x * x, 0) / amps.length);
    const threshold = sd * 0.6;

    const peaks = [];
    for (let i = 1; i < smooth.length - 1; i += 1) {
      const prev = smooth[i - 1].v;
      const cur = smooth[i].v;
      const next = smooth[i + 1].v;
      if (cur > prev && cur > next && cur > threshold) peaks.push(smooth[i].ts);
    }

    if (peaks.length < 3) return null;
    const intervals = [];
    for (let i = 1; i < peaks.length; i += 1) {
      const dt = peaks[i] - peaks[i - 1];
      if (dt > 350 && dt < 1500) intervals.push(dt);
    }
    if (!intervals.length) return null;

    const rr = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const hr = 60000 / rr;
    if (hr < 40 || hr > 180) return null;
    return Math.round(hr);
  }

  disconnect() {
    if (this.characteristic) {
      this.characteristic.stopNotifications().catch(() => {});
      this.characteristic = null;
    }
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();

    if (this.ppgTimer) {
      clearInterval(this.ppgTimer);
      this.ppgTimer = null;
    }

    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }

    if (this.ppgStream) {
      this.ppgStream.getTracks().forEach((track) => track.stop());
      this.ppgStream = null;
    }
  }
}
