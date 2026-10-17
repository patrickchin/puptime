'use no memo';

import { TextWidget, type TextWidgetProps } from 'react-native-android-widget';

type Props = Omit<TextWidgetProps, 'text'> & { at: number };

// The config plugin replaces this measured text with a live RemoteViews Chronometer.
export function ChronometerWidget(_: Props) {
  return null;
}
ChronometerWidget.__name__ = 'TextWidget';
ChronometerWidget.convertProps = ({ at, ...props }: Props) => ({
  ...TextWidget.convertProps({ ...props, text: '888:88:88 ago' }),
  elapsedAt: at,
});
