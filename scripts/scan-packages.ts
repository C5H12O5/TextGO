#!/usr/bin/env node
import { execSync } from 'child_process';
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __DIRNAME = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__DIRNAME, '..');

const BACKEND_JSON = join(__DIRNAME, '.backend.json');
const FRONTEND_JSON = join(__DIRNAME, '.frontend.json');
const OUTPUT_PATH = join(PROJECT_ROOT, 'LICENSES.md');

const PACKAGE_JSON = join(PROJECT_ROOT, 'package.json');
const CARGO_TOML = join(PROJECT_ROOT, 'src-tauri', 'Cargo.toml');

interface Package {
  name: string;
  version?: string | null;
  repository?: string | null;
  description?: string | null;
  license?: string | null;
  licenses?: string | null;
}

/**
 * Execute license-checker command.
 *
 * https://github.com/davglass/license-checker
 */
function runLicenseChecker() {
  console.log('🔍 Running license-checker for frontend dependencies...');
  try {
    const command = `pnpm dlx license-checker --direct --json --customPath ./scripts/.format.json --out ${FRONTEND_JSON}`;
    execSync(command, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });
    console.log('✅ Frontend license data generated successfully');
  } catch (error) {
    console.error('❌ Error running license-checker:', error);
    throw error;
  }
}

/**
 * Execute cargo license command.
 *
 * https://github.com/onur/cargo-license
 */
function runCargoLicense() {
  console.log('🔍 Running cargo license for backend dependencies...');
  try {
    const command = `cargo license --direct-deps-only -j --manifest-path ./src-tauri/Cargo.toml -o ${BACKEND_JSON}`;
    execSync(command, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });
    console.log('✅ Backend license data generated successfully');
  } catch (error) {
    console.error('❌ Error running cargo license:', error);
    throw error;
  }
}

/**
 * Parse frontend dependencies JSON file.
 *
 * @returns array of dependency data
 */
function parseFrontendJson(): Package[] {
  console.log('📖 Parsing frontend license data...');
  try {
    const jsonContent = readFileSync(FRONTEND_JSON, 'utf-8');
    const data: { [key: string]: Package } = JSON.parse(jsonContent);
    const packages = new Map<string, Package>();
    for (const pkg of Object.values(data)) {
      // map licenses field to license
      packages.set(pkg.name, { ...pkg, license: pkg.licenses });
    }
    console.log(`✅ Found ${packages.size} frontend packages`);
    return Array.from(packages.values());
  } catch (error) {
    console.error('❌ Error parsing frontend JSON file:', error);
    throw error;
  }
}

/**
 * Parse backend dependencies JSON file.
 *
 * @returns array of dependency data
 */
function parseBackendJson(): Package[] {
  console.log('📖 Parsing backend license data...');
  try {
    const jsonContent = readFileSync(BACKEND_JSON, 'utf-8');
    const data: Package[] = JSON.parse(jsonContent);
    const packages = new Map<string, Package>();
    for (const pkg of data) {
      packages.set(pkg.name, pkg);
    }
    console.log(`✅ Found ${packages.size} backend packages`);
    return Array.from(packages.values());
  } catch (error) {
    console.error('❌ Error parsing backend JSON file:', error);
    throw error;
  }
}

/**
 * Generate Markdown table for dependency data.
 *
 * @param packages - dependency data
 * @param title - table title
 * @returns array of table rows
 */
function generateTable(packages: Package[], title: string): string[] {
  const table: string[] = [];
  // filter out the project itself
  const pkgs = packages.filter((pkg) => pkg.name !== 'text-go' && pkg.name !== 'TextGO');
  // add title
  table.push(`## ${title}\n`);
  table.push(`> **${pkgs.length}** packages included\n`);
  // add table header
  table.push('| Package | Version | License | Description |');
  table.push('|---------|---------|---------|-------------|');
  // add table content
  for (const pkg of pkgs) {
    const name = pkg.repository ? `[${pkg.name}](${pkg.repository})` : pkg.name;
    const version = pkg.version || '-';
    const license = pkg.license || 'Unknown';
    // escape pipes in description to avoid breaking table structure
    const description = (pkg.description || '-').replace(/\|/g, '\\|');

    table.push(`| ${name} | ${version} | ${license} | ${description} |`);
  }
  table.push('');
  return table;
}

/**
 * Generate complete Markdown document.
 *
 * @param frontendData - frontend dependency data
 * @param backendData - backend dependency data
 */
function generateLicenses(frontendData: Package[], backendData: Package[]) {
  const markdown: string[] = [];
  // add document title
  markdown.push('# Third-Party License Notices\n');
  markdown.push(
    `> This document was automatically generated on ${new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    })}\n`
  );
  // add frontend dependencies table
  markdown.push(...generateTable(frontendData, 'Frontend Dependencies'));
  // add backend dependencies table
  markdown.push(...generateTable(backendData, 'Backend Dependencies'));

  console.log('📝 Writing markdown file...');
  try {
    writeFileSync(OUTPUT_PATH, markdown.join('\n'), 'utf-8');
    console.log('✅ Markdown file generated:', OUTPUT_PATH);
  } catch (error) {
    console.error('❌ Error writing markdown file:', error);
    throw error;
  }
}

/**
 * Get Svelte version number.
 *
 * @return version string
 */
function getSvelteVersion(): string {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));
  const svelteVersion = packageJson.devDependencies?.svelte || packageJson.dependencies?.svelte;
  if (!svelteVersion) {
    throw new Error('Svelte version not found in package.json');
  }
  return svelteVersion.replace(/^[\^~]/, '');
}

/**
 * Get Tauri version number.
 *
 * @return version string
 */
function getTauriVersion(): string {
  const cargoToml = readFileSync(CARGO_TOML, 'utf-8');
  const match = cargoToml.match(/tauri\s*=\s*\{\s*version\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error('Tauri version not found in Cargo.toml');
  }
  return match[1];
}

/**
 * Update all README files in project root directory.
 */
function updateReadme() {
  const svelteVersion = getSvelteVersion();
  console.log(`📋 Svelte version: ${svelteVersion}`);

  const tauriVersion = getTauriVersion();
  console.log(`📋 Tauri version: ${tauriVersion}`);

  const rootFiles = readdirSync(PROJECT_ROOT);
  const readmeFiles = rootFiles.filter((f) => f.startsWith('README') && f.endsWith('.md'));
  console.log(`📖 Found ${readmeFiles.length} README files:`, readmeFiles);

  for (const filename of readmeFiles) {
    const readmeFile = join(PROJECT_ROOT, filename);
    let readme = readFileSync(readmeFile, 'utf-8');
    // use regex to replace version numbers
    readme = readme.replace(/Tauri-v[\d.]+/g, `Tauri-v${tauriVersion}`);
    readme = readme.replace(/Svelte-v[\d.]+/g, `Svelte-v${svelteVersion}`);
    writeFileSync(readmeFile, readme, 'utf-8');
    console.log(`✅ Updated ${filename}`);
  }
  console.log('🎉 All README files updated successfully');
}

// 1. run license-checker
runLicenseChecker();
// 2. run cargo license
runCargoLicense();
// 3. parse and generate LICENSES.md
generateLicenses(parseFrontendJson(), parseBackendJson());
// 4. update README files
updateReadme();
