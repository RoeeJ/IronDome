import path from 'node:path';
import { MODEL_CONFIGS } from '@/config/ModelRegistry';

const root = path.resolve('dist');
const { basePath } = (await Bun.file(path.join(root, 'build-info.json')).json()) as {
  basePath: string;
};
let checked = 0;

async function requireFile(relativePath: string) {
  const file = Bun.file(path.join(root, relativePath));
  if (!(await file.exists())) throw new Error(`Missing build asset: ${relativePath}`);
  checked++;
}

// Check every published HTML page, including the friendly directory routes.
for (const route of [
  'index.html',
  'model-viewer/index.html',
  'tube-editor/index.html',
  'rigger/index.html',
]) {
  await requireFile(route);
}
for await (const htmlPath of new Bun.Glob('**/*.html').scan(root)) {
  const html = await Bun.file(path.join(root, htmlPath)).text();
  for (const [, reference] of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = new URL(reference, `https://preview.example${basePath}${htmlPath}`);
    if (url.origin !== 'https://preview.example') continue;
    if (!url.pathname.startsWith(basePath)) {
      throw new Error(`${htmlPath} references a URL outside BASE_PATH: ${reference}`);
    }
    await requireFile(decodeURIComponent(url.pathname.slice(basePath.length)));
  }
}

// Runtime-loaded models and sounds are invisible to the HTML bundler.
for (const model of Object.values(MODEL_CONFIGS)) {
  await requireFile(model.path.replace(/^\//, ''));
}
const soundSource = await Bun.file('src/systems/SoundSystem.ts').text();
for (const [, soundPath] of soundSource.matchAll(/'(assets\/sounds\/normalized\/[^']+)'/g)) {
  await requireFile(soundPath);
}
for await (const gltfPath of new Bun.Glob('assets/**/*.gltf').scan(root)) {
  const gltf = (await Bun.file(path.join(root, gltfPath)).json()) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };
  for (const { uri } of [...(gltf.buffers || []), ...(gltf.images || [])]) {
    if (!uri || /^(data:|https?:)/.test(uri)) continue;
    await requireFile(path.join(path.dirname(gltfPath), decodeURIComponent(uri)));
  }
}

console.log(`Static build verified: ${checked} file references under ${basePath}`);
