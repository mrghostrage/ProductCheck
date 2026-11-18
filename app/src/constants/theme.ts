import { useColorScheme } from 'react-native';

// iOS system colors. `sheet` is the background of sheets; `cell2` is a grouped cell drawn on a sheet.
export const System = {
  light: {
    bg: '#f2f2f7', sheet: '#f2f2f7', cell: '#ffffff', cell2: '#ffffff', label: '#000000', sec: '#3c3c4399', ter: '#3c3c434d', sep: '#3c3c4324', fill: '#7878801f',
    red: '#ff3b30', orange: '#ff9500', green: '#34c759', blue: '#007aff', gray: '#8e8e93',
  },
  dark: {
    bg: '#000000', sheet: '#1c1c1e', cell: '#1c1c1e', cell2: '#2c2c2e', label: '#ffffff', sec: '#ebebf599', ter: '#ebebf54d', sep: '#54545873', fill: '#7878803d',
    red: '#ff453a', orange: '#ff9f0a', green: '#30d158', blue: '#0a84ff', gray: '#8e8e93',
  },
} as const;

export type SystemPalette = { [K in keyof typeof System.light]: string };
export type Tone = 'red' | 'orange' | 'green' | 'blue' | 'gray';

export function useSystemColors(): SystemPalette & { dark: boolean } {
  const dark = useColorScheme() === 'dark';
  return { ...System[dark ? 'dark' : 'light'], dark };
}
