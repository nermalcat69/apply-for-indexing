const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const outdir = 'dist';

// Ensure dist and dist/icons exist
fs.mkdirSync(outdir, { recursive: true });
fs.mkdirSync(path.join(outdir, 'icons'), { recursive: true });

// Copy static files
const staticFiles = [
  ['manifest.json', 'manifest.json'],
  ['src/popup/popup.html', 'popup.html'],
  ['src/popup/popup.css', 'popup.css'],
];

for (const [src, dest] of staticFiles) {
  fs.copyFileSync(src, path.join(outdir, dest));
}

// Copy icons if they exist
const iconSizes = [16, 48, 128];
for (const size of iconSizes) {
  const srcPath = `icons/icon${size}.png`;
  const destPath = path.join(outdir, 'icons', `icon${size}.png`);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
  }
}

const buildOptions = {
  entryPoints: {
    background: 'src/background/background.ts',
    content: 'src/content/content.ts',
    popup: 'src/popup/popup.ts',
  },
  bundle: true,
  outdir,
  format: 'esm',
  target: 'chrome120',
  sourcemap: process.env.NODE_ENV !== 'production',
  logLevel: 'info',
};

if (isWatch) {
  esbuild.context(buildOptions).then((ctx) => {
    ctx.watch();
    console.log('Watching for changes...');
  });
} else {
  esbuild.build(buildOptions).then(() => {
    console.log('Build complete! Load the dist/ folder in Chrome.');
  }).catch(() => process.exit(1));
}
