import { readFile, writeFile } from 'node:fs/promises';

const sourcePath = new URL('../src/icons/recenter.svg', import.meta.url);
const outputPath = new URL('../src/icons/recenter.generated.ts', import.meta.url);
const svg = await readFile(sourcePath, 'utf8');

await writeFile(
  outputPath,
  `// Generated from src/icons/recenter.svg; do not edit manually.\nexport const RECENTER_ICON_SVG = ${JSON.stringify(svg)};\n`,
);
