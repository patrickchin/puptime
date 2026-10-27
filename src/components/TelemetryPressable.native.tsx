import { useRef } from 'react';
import { Pressable as NativePressable, type PressableProps } from 'react-native';
import { productTelemetry } from '../telemetry';
import { telemetryControl } from '../product-telemetry';

// Refs keep press timing local: no context updates or history-row rerenders.
export function Pressable({ onPress, onLongPress, onPressIn, onPressOut, ...props }: PressableProps & { ref?: React.Ref<React.ComponentRef<typeof NativePressable>> }) {
  const timing = useRef<{ start?: number; end?: number; long: boolean }>({ long: false });
  const control = telemetryControl(props.testID);
  const capture = () => {
    const { start, end, long } = timing.current;
    if (control) productTelemetry.capture('app_press', { control, long_press: long,
      ...(start === undefined ? {} : { press_duration_ms: Math.max(0, (end ?? performance.now()) - start) }) });
    timing.current = { long: false };
  };
  return <NativePressable {...props}
    onPressIn={event => { timing.current = { start: performance.now(), long: false }; onPressIn?.(event); }}
    onPressOut={event => { timing.current.end = performance.now(); onPressOut?.(event); }}
    onLongPress={onLongPress ? event => { timing.current.long = true; capture(); onLongPress(event); } : undefined}
    onPress={onPress ? event => { capture(); onPress(event); } : undefined}
  />;
}
