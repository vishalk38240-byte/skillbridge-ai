import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import aiHandler from './api/ai.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (!process.env.GROQ_API_KEY && env.GROQ_API_KEY) process.env.GROQ_API_KEY = env.GROQ_API_KEY;

  return {
    plugins: [
      react(),
      {
        name: 'local-ai-api',
        configureServer(server) {
          server.middlewares.use('/api/ai', (req, res) => {
            void aiHandler(req, res);
          });
        }
      }
    ]
  };
});
