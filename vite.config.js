import {studioLibraryPlugin} from './tools/asset-studio/local-library.mjs';
import {defineConfig} from 'vite';

export default defineConfig({plugins:[studioLibraryPlugin()],worker:{format:'es'}});
