import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    root:'frontend',plugins:[vue(),tailwindcss()],
    cacheDir:'../.tmp/vite-cache',
    build:{outDir:'../.tmp/web-dist',emptyOutDir:true},
    server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:8787'}},
});
