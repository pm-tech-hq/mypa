/** A soft three-note chime, played three times (about 4 seconds). */
let ctx: AudioContext | null = null;

export function chime(): void {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const start = ctx.currentTime + 0.05;
    const notes = [880, 1108.73, 1318.51];
    for (let round = 0; round < 3; round++) {
      notes.forEach((freq, i) => {
        const t = start + round * 1.3 + i * 0.16;
        const osc = ctx!.createOscillator();
        const gain = ctx!.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        osc.connect(gain).connect(ctx!.destination);
        osc.start(t);
        osc.stop(t + 1);
      });
    }
  } catch {
    /* no audio device */
  }
}
