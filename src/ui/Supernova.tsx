import { useEffect, useRef, useState } from 'react';
import { FRAG, hexToLinear, MAX_PULSES, PULSE_LIFE, VERT } from '../lib/nova';
import { onPulse } from '../fx';
import { useMedia, useReduce } from '../hooks';
import { useApp } from '../store';

const FPS = 30, SLOW_MS = 60, SLOW_FRAMES = 15; // about a second of slow frames in a row, then a still frame
type Mode = 'live' | 'still' | 'css';
/** Core position as a fraction of the screen: off-centre, upper right. */
const corePos = (wide: boolean) => (wide ? [0.6, 0.3] : [0.78, 0.2]);

/** A slow, dark supernova behind everything. One WebGL2 fragment shader at about half the device resolution,
 *  capped near 30 fps and paused while the app is hidden. It falls back to a single still frame when motion is
 *  reduced or the device cannot keep up, and to a CSS gradient when WebGL2 is missing.
 *  `level` (0..1) is today's completion: the core brightens as the day gets done. */
export function Supernova({ level }: { level: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = useReduce();
  const wide = useMedia('(min-width: 860px)');
  const [mode, setMode] = useState<Mode>(() => ((window as any).__LP_BG as Mode) || 'live');
  const target = useRef(level); target.current = level;
  // Choosing a motion setting again gives a device that fell back to a still frame another try.
  const motionPref = useApp((s) => s.settings.motion);
  useEffect(() => { setMode((m) => (m === 'still' && !(window as any).__LP_BG ? 'live' : m)); }, [motionPref]);
  const want: Mode = mode === 'css' ? 'css' : reduce || mode === 'still' ? 'still' : 'live';

  useEffect(() => {
    if (want === 'css') return;
    const cv = ref.current!;
    const gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: want === 'still' });
    if (!gl) { setMode('css'); return; }
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('supernova shader', gl.getProgramInfoLog(prog)); setMode('css'); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = U('u_res'), uT = U('u_t'), uLevel = U('u_level'), uAcc = U('u_acc'), uBg = U('u_bg'), uCore = U('u_core'), uPulse = U('u_pulse');
    const css = getComputedStyle(document.documentElement);
    gl.uniform3fv(uAcc, hexToLinear(css.getPropertyValue('--accent')));
    gl.uniform3fv(uBg, hexToLinear(css.getPropertyValue('--bg')));

    let scale = 1, raf = 0, last = 0, lvl = target.current, slow = 0, dead = false;
    const t0 = performance.now() - 40000; // start mid-flight, so rings are already on screen
    const pulses = new Float32Array(MAX_PULSES * 4); let next = 0, pulseUntil = 0;
    const size = () => {
      scale = Math.min(1, (window.devicePixelRatio || 1) * 0.5); // about half the device resolution
      const w = Math.max(1, Math.round(cv.clientWidth * scale)), h = Math.max(1, Math.round(cv.clientHeight * scale));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
    };
    const draw = (now: number) => {
      size();
      const [cx, cy] = corePos(matchMedia('(min-width: 860px)').matches);
      gl.uniform2f(uRes, cv.width, cv.height); gl.uniform2f(uCore, cx * cv.width, cy * cv.height);
      gl.uniform1f(uT, want === 'still' ? 40 : (now - t0) / 1000);
      gl.uniform1f(uLevel, lvl); gl.uniform4fv(uPulse, pulses);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      if (dead) return;
      raf = requestAnimationFrame(loop);
      const dt = now - last;
      if (dt < 1000 / FPS - 2) return;
      // Sustained slow frames (not one hiccup): stop animating and keep a still frame.
      if (last && dt < 400) { slow = dt > SLOW_MS ? slow + 1 : Math.max(0, slow - 2); if (slow > SLOW_FRAMES) { setMode('still'); return; } }
      last = now;
      lvl += (target.current - lvl) * 0.06;
      draw(now);
    };
    const start = () => { if (want === 'live' && !document.hidden && !raf) { last = 0; raf = requestAnimationFrame(loop); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const vis = () => (document.hidden ? stop() : start());
    const still = () => { lvl = target.current; draw(performance.now()); };
    const offPulse = want === 'live' ? onPulse((x, y) => {
      const now = (performance.now() - t0) / 1000;
      pulses.set([x * scale, y * scale, now, 1], next * 4); next = (next + 1) % MAX_PULSES; pulseUntil = now + PULSE_LIFE;
    }) : () => {};
    void pulseUntil;
    const lost = (e: Event) => { e.preventDefault(); setMode('css'); };
    cv.addEventListener('webglcontextlost', lost);
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('resize', still);
    if (want === 'live') start(); else still();
    (window as any).__nova = { mode: want, redraw: still };
    return () => { dead = true; stop(); offPulse(); cv.removeEventListener('webglcontextlost', lost); document.removeEventListener('visibilitychange', vis); window.removeEventListener('resize', still); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want]);
  // A still frame is redrawn when the day's completion changes.
  useEffect(() => { if (want === 'still') (window as any).__nova?.redraw?.(); }, [level, want]);

  const [cx, cy] = corePos(wide);
  if (want === 'css') return <div className="nova-still" data-nova="css" aria-hidden="true" style={{ ['--cx' as string]: `${cx * 100}%`, ['--cy' as string]: `${cy * 100}%`, opacity: 0.5 + 0.5 * level }} />;
  return <canvas key={want} ref={ref} className="nova" data-nova={want} aria-hidden="true" />;
}
