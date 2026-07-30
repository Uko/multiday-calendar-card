import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/multiday-calendar-card.ts',
  output: {
    file: 'dist/multiday-calendar-card.js',
    format: 'es',
    sourcemap: true,
  },
  plugins: [resolve(), typescript()],
};
