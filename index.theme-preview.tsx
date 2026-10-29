// Native palette comparison using the real app and its local sample journal.
// Open puptime://theme-preview?variant=ink (or sage, cream, forest).
import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { PuptimeApp } from './App';
import { themePreviews, themePreviewFromUrl, type ThemePreview } from './src/theme-previews';

function ThemePreviewApp() {
  const [variant, setVariant] = useState<ThemePreview>('ink');
  useEffect(() => {
    const open = (url: string | null) => {
      const next = url && themePreviewFromUrl(url);
      if (next) setVariant(next);
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener('url', event => open(event.url));
    return () => subscription.remove();
  }, []);
  return <View testID={`preview.theme.${variant}`} style={{ flex: 1 }}><PuptimeApp key={variant} conversationalOnboarding themeOverride={themePreviews[variant].theme} /></View>;
}
registerRootComponent(ThemePreviewApp);
