import type { NotificationPermissionState } from './reminders';
import type { Theme } from './theme';

export type FinishOnboardingOptions = { puppyName?: string };

export type OnboardingScreenProps = {
  theme: Theme;
  mode: 'first-run' | 'replay' | 'embedded';
  notificationPermission: NotificationPermissionState;
  onAllowNotifications: () => Promise<boolean>;
  onOpenSystemSettings: () => void;
  onFinish: (options?: FinishOnboardingOptions) => Promise<void>;
  onBack: () => boolean;
};
