export class SensorHub {
  constructor(onHeartRate) {
    this.onHeartRate = onHeartRate;
    this.device = null;
    this.characteristic = null;
    this.ppgStream = null;
    this.ppgInterval = null;
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
      const is16Bit = flags & 0x1;
      const hr = is16Bit ? value.getUint16(1, true) : value.getUint8(1);
      this.onHeartRate(hr, performance.now());
    });
    return `Connected to ${this.device.name || 'heart rate device'}`;
  }

  async connectCameraPPG() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is not supported in this browser.');
    }
    this.ppgStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });

    // Placeholder PPG: generates stable synthetic HR until full camera signal processing is added.
    // For production: replace with POS/CHROM or rPPG pipeline (bandpass + peak detection).
    let hr = 72;
    this.ppgInterval = setInterval(() => {
      hr += (Math.random() - 0.5) * 1.2;
      this.onHeartRate(Math.max(48, Math.min(110, Math.round(hr))), performance.now());
    }, 1000);

    return 'Camera PPG enabled (experimental synthetic feed).';
  }

  disconnect() {
    if (this.characteristic) {
      this.characteristic.stopNotifications().catch(() => {});
    }
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    if (this.ppgInterval) clearInterval(this.ppgInterval);
    if (this.ppgStream) {
      this.ppgStream.getTracks().forEach((track) => track.stop());
    }
  }
}
