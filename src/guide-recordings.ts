import manifest from '../assets/puppy-care/audio/manifest.json';

export type GuideRecording = { source: number; script: string; duration: number; voice: string; model: string; attribution: boolean };

// Static asset references make the recordings available offline in native builds.
export const guideRecordings: Record<string, GuideRecording> = {
  'getting-started': { ...manifest['getting-started'], source: require('../assets/puppy-care/audio/getting-started.mp3') },
  'bringing-puppy-home': { ...manifest['bringing-puppy-home'], source: require('../assets/puppy-care/audio/bringing-puppy-home.mp3') },
  'toilet-training': { ...manifest['toilet-training'], source: require('../assets/puppy-care/audio/toilet-training.mp3') },
  'feeding': { ...manifest['feeding'], source: require('../assets/puppy-care/audio/feeding.mp3') },
  'sleep-and-first-nights': { ...manifest['sleep-and-first-nights'], source: require('../assets/puppy-care/audio/sleep-and-first-nights.mp3') },
  'exercise-and-play': { ...manifest['exercise-and-play'], source: require('../assets/puppy-care/audio/exercise-and-play.mp3') },
  'socialisation': { ...manifest['socialisation'], source: require('../assets/puppy-care/audio/socialisation.mp3') },
  'training-basics': { ...manifest['training-basics'], source: require('../assets/puppy-care/audio/training-basics.mp3') },
  'biting-and-chewing': { ...manifest['biting-and-chewing'], source: require('../assets/puppy-care/audio/biting-and-chewing.mp3') },
  'time-alone': { ...manifest['time-alone'], source: require('../assets/puppy-care/audio/time-alone.mp3') },
  'handling-and-grooming': { ...manifest['handling-and-grooming'], source: require('../assets/puppy-care/audio/handling-and-grooming.mp3') },
  'first-vet-visits': { ...manifest['first-vet-visits'], source: require('../assets/puppy-care/audio/first-vet-visits.mp3') },
  'when-to-call-a-vet': { ...manifest['when-to-call-a-vet'], source: require('../assets/puppy-care/audio/when-to-call-a-vet.mp3') },
};
