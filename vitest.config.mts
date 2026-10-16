import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Lets tests resolve imports like '@models/recipeModel' the same way the app does
  plugins: [tsconfigPaths()],
  test: {
    setupFiles: ['./tests/setup.ts'],
    // Starting the in-memory database can be slow, and the very first run
    // downloads MongoDB (~600MB) into node_modules/.cache
    hookTimeout: 300000,
  },
});
