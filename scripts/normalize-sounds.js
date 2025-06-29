#!/usr/bin/env bun

import { $ } from 'bun';
import { readdir, mkdir } from 'fs/promises';
import { join } from 'path';

const SOUNDS_DIR = join(process.cwd(), 'assets/sounds');
const OUTPUT_DIR = join(process.cwd(), 'assets/sounds/normalized');

// Target format: MP3, 128kbps, 44.1kHz, mono
const FFMPEG_OPTIONS = [
  '-ar',
  '44100', // Sample rate
  '-ac',
  '1', // Mono
  '-b:a',
  '128k', // Bitrate
  '-acodec',
  'mp3', // Codec
];

async function normalizeAudio() {
  console.log('🎵 Normalizing audio files...\n');

  // Create output directory
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Find all audio files
  const audioFiles = [];
  const categories = ['launch', 'impact', 'flyby'];

  for (const category of categories) {
    const categoryDir = join(SOUNDS_DIR, category);
    try {
      const files = await readdir(categoryDir);
      for (const file of files) {
        if (file.match(/\.(mp3|wav|ogg)$/i)) {
          audioFiles.push({
            path: join(categoryDir, file),
            category,
            filename: file,
          });
        }
      }
    } catch (e) {
      console.warn(`Category ${category} not found`);
    }
  }

  console.log(`Found ${audioFiles.length} audio files to normalize\n`);

  // Process each file
  for (const { path, category, filename } of audioFiles) {
    const outputCategory = join(OUTPUT_DIR, category);
    await mkdir(outputCategory, { recursive: true });

    const outputName = filename.replace(/\.(mp3|wav|ogg)$/i, '.mp3');
    const outputPath = join(outputCategory, outputName);

    console.log(`Processing: ${category}/${filename}`);

    try {
      // Use ffmpeg to normalize
      await $`ffmpeg -i ${path} ${FFMPEG_OPTIONS} -y ${outputPath}`;
      console.log(`✓ Normalized to: ${category}/${outputName}\n`);
    } catch (error) {
      console.error(`✗ Failed to process ${filename}: ${error.message}\n`);
    }
  }

  console.log('✅ Audio normalization complete!');
  console.log(`\nNormalized files saved to: ${OUTPUT_DIR}`);
}

// Run normalization
normalizeAudio().catch(console.error);
