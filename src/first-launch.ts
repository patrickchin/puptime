import {z} from 'zod';
import type {OnboardingScreenProps} from './onboarding';
import type {CloudHandle} from './cloud/handle';

export const firstLaunchStepSchema=z.enum(['welcome','profile','account','cloud','walkthrough','reminders']);
export type FirstLaunchStep=z.infer<typeof firstLaunchStepSchema>;
export type FirstLaunchProgress={step:FirstLaunchStep;puppyName:string};
export type FirstLaunchScreenProps=Omit<OnboardingScreenProps,'mode'|'onBack'>&{
  progress:FirstLaunchProgress;
  cloud:CloudHandle;
  onDisableNotifications:()=>Promise<void>;
};
