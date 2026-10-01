import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { mainConfig } from './webpack.main';
import { rendererConfig } from './webpack.renderer';

const config: ForgeConfig = {
  outDir: process.env.FIELORA_OUT_DIR || 'out',
  packagerConfig: {
    asar: true,
    appBundleId: 'com.fielora.desktop',
    appCategoryType: 'public.app-category.developer-tools',
    executableName: 'Fielora',
    name: 'Fielora',
    icon: path.resolve(__dirname, 'assets', process.platform === 'darwin' ? 'fielora.icns' : 'fielora.ico'),
    extraResource: [path.resolve(__dirname, '../../target/release', process.platform === 'win32' ? 'fielora-core.exe' : 'fielora-core')],
    electronZipDir: process.env.FIELORA_ELECTRON_ZIP_DIR || undefined,
  },
  rebuildConfig: {},
  makers: [new MakerZIP({})],
  plugins: [
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/renderer/index.html',
            js: './src/renderer/index.tsx',
            name: 'main_window',
            preload: { js: './src/preload.ts' },
          },
        ],
      },
    }),
  ],
};

export default config;
