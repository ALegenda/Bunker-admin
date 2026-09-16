import { defineConfig } from 'vite';
export default defineConfig({ root:'frontend', publicDir:false, build:{outDir:'../web-dist',emptyOutDir:true}, server:{host:'127.0.0.1',proxy:{'/api':'http://127.0.0.1:4173','/auth':'http://127.0.0.1:4173','/releases':'http://127.0.0.1:4173'}} });
