import { darkTheme, lightTheme, type Theme } from './theme.ts';

// Opt-in visual comparisons. The normal app entry does not import these palettes.
export const themePreviews = {
  ink: {
    label: 'Green ink',
    theme: {
      ...lightTheme,
      canvas: '#FAFCFA', onCanvas: '#176B52', onCanvasMuted: '#56675E', canvasBorder: '#D8E5DC',
      background: '#F3F7F3', surface: '#FFFFFF', surfaceRaised: '#FFFFFF',
      text: '#174D3B', textMuted: '#56675E', border: '#D8E5DC',
      primarySoft: '#E4F0E8', nav: '#FAFCFA',
    },
  },
  sage: {
    label: 'Soft sage',
    theme: {
      ...lightTheme,
      canvas: '#EAF2EB', onCanvas: '#244B3B', onCanvasMuted: '#52675A', canvasBorder: '#C9DBCD',
      background: '#EEF5EF', surface: '#F8FCF8', surfaceRaised: '#FFFFFF',
      text: '#20382C', textMuted: '#52675A', border: '#CFDFD2',
      primarySoft: '#DCECDD', nav: '#EAF2EB',
    },
  },
  cream: {
    label: 'Cream & emerald',
    theme: {
      ...lightTheme,
      canvas: '#FBF6E9', onCanvas: '#303B32', onCanvasMuted: '#65685A', canvasBorder: '#E1DFCE',
      background: '#F6F1E4', surface: '#FFFCF3', surfaceRaised: '#FFFEF9',
      text: '#303B32', textMuted: '#65685A', border: '#E3E1D2',
      primarySoft: '#E8EEDF', nav: '#FBF6E9',
    },
  },
  forest: {
    label: 'Forest at night',
    theme: {
      ...darkTheme,
      canvas: '#123F32', onCanvas: '#FFF9EB', onCanvasMuted: '#D0DED1', canvasBorder: '#537D68',
      background: '#163F32', surface: '#194B3A', surfaceRaised: '#1D513E',
      text: '#FFF9EB', textMuted: '#D0DED1', border: '#537D68',
      primary: '#F4E5C5', onPrimary: '#174331', primaryPressed: '#E5D5AF', primarySoft: '#2B5D47',
      nav: '#123F32',
    },
  },
} satisfies Record<string, { label: string; theme: Theme }>;

export type ThemePreview = keyof typeof themePreviews;

export function themePreviewFromUrl(url: string): ThemePreview | null {
  try {
    const value = new URL(url).searchParams.get('variant');
    return value && Object.hasOwn(themePreviews, value) ? value as ThemePreview : null;
  } catch { return null; }
}
