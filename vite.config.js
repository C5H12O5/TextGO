import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFile } from 'node:fs/promises';
import { parse } from 'svelte/compiler';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    {
      name: 'phosphor-regular',
      apply: 'build',
      enforce: 'pre',
      /**
       * Resolves named icons to separate regular-only components asynchronously.
       * @param {string} source - The requested module.
       * @param {string | undefined} importer - The importing file.
       * @returns {Promise<string | undefined>} The virtual component path, or undefined for other imports.
       */
      async resolveId(source, importer) {
        if (!importer?.endsWith('/src/lib/phosphor.ts') || !source.startsWith('phosphor-svelte/lib/')) return;
        const resolved = await this.resolve(source, importer, { skipSelf: true });
        if (!resolved?.id.endsWith('.svelte')) this.error(`Cannot resolve Phosphor icon: ${source}`);
        // use a separate filename so svelte does not share its cache with the full component
        return resolved.id.replace(/\.svelte$/, '.regular.svelte');
      },
      /**
       * Loads the original SVG with only its regular weight branch asynchronously.
       * @param {string} id - The resolved module path.
       * @returns {Promise<string | undefined>} The specialized source, or undefined for other modules.
       */
      async load(id) {
        if (!id.includes('/phosphor-svelte/lib/') || !id.endsWith('.regular.svelte')) return;
        const original = id.replace(/\.regular\.svelte$/, '.svelte');
        this.addWatchFile(original);
        const source = await readFile(original, 'utf8');
        const svg = parse(source, { modern: true }).fragment.nodes.find(
          (node) => node.type === 'RegularElement' && node.name === 'svg'
        );
        const block =
          svg?.type === 'RegularElement'
            ? svg.fragment.nodes.find(
                (node) =>
                  node.type === 'IfBlock' &&
                  node.test.type === 'BinaryExpression' &&
                  node.test.left.type === 'Identifier' &&
                  node.test.left.name === 'weight'
              )
            : undefined;
        let regular = block;
        while (regular?.type === 'IfBlock') {
          const test = regular.test;
          if (
            test.type === 'BinaryExpression' &&
            test.operator === '===' &&
            test.left.type === 'Identifier' &&
            test.left.name === 'weight' &&
            test.right.type === 'Literal' &&
            test.right.value === 'regular'
          )
            break;
          regular = regular.alternate?.nodes[0];
        }
        if (block?.type !== 'IfBlock' || regular?.type !== 'IfBlock') {
          this.error(`Cannot find the regular weight in Phosphor icon: ${original}`);
        }
        return (
          source.slice(0, block.start) +
          regular.consequent.nodes.map((node) => source.slice(node.start, node.end)).join('') +
          source.slice(block.end)
        );
      }
    },
    tailwindcss(),
    sveltekit(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      strategy: ['localStorage', 'preferredLanguage', 'url', 'baseLocale']
    })
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**']
    }
  }
});
