import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/multi-day-calendar-card.ts',
  output: {
    file: 'dist/multi-day-calendar-card.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: [resolve(), typescript()],
};
