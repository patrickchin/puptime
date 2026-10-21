// Explicit simulator-only entry point. The normal app entry remains index.ts.
import {registerRootComponent} from 'expo';
import {OnboardingDesignPreview} from './src/screens/OnboardingDesignPreview';

registerRootComponent(OnboardingDesignPreview);
