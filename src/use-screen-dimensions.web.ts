import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';

export function useScreenDimensions() {
  const dimensions = useWindowDimensions();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Use the same first render in Node and the browser, then adapt to the viewport.
  return mounted ? dimensions : { width: 1280, height: 800, scale: 1, fontScale: 1 };
}
