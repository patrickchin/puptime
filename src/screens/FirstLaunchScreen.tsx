import {OnboardingScreen} from './OnboardingScreen';
import {shouldShowOnboarding} from '../storage';
import type {FirstLaunchProgress,FirstLaunchScreenProps} from '../first-launch';

export async function loadInitialSetup():Promise<FirstLaunchProgress|null> {
  return await shouldShowOnboarding()?{step:'welcome',puppyName:'My puppy'}:null;
}
// Browser activity fallback; phones resolve the shared native setup wizard.
export function FirstLaunchScreen(props:FirstLaunchScreenProps) {
  return <OnboardingScreen {...props} mode="first-run" onBack={()=>false}/>;
}
