// Native design entry with the real app and persistent local storage.
import {registerRootComponent} from 'expo';
import {PuptimeApp} from './App';
function OnboardingPreviewApp(){return <PuptimeApp conversationalOnboarding/>;}
registerRootComponent(OnboardingPreviewApp);
