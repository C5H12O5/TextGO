export type Theme = 'light' | 'dark' | 'system' | 'system-inverse';

export type ResolvedTheme = 'light' | 'dark';

/**
 * Check whether a theme follows the system appearance.
 *
 * @param setting - theme setting
 * @returns true if the theme follows the system appearance, false otherwise
 */
export function isSystemTheme(setting: Theme): setting is 'system' | 'system-inverse' {
  return setting === 'system' || setting === 'system-inverse';
}

/**
 * Resolve a theme setting to a concrete light or dark theme.
 *
 * @param setting - theme setting
 * @param prefersDark - whether the system prefers a dark appearance
 * @returns resolved light or dark theme
 */
export function resolveTheme(setting: Theme, prefersDark: boolean): ResolvedTheme {
  if (setting === 'system') {
    return prefersDark ? 'dark' : 'light';
  }
  if (setting === 'system-inverse') {
    return prefersDark ? 'light' : 'dark';
  }
  return setting;
}
