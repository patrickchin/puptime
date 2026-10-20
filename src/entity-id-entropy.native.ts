import uuid from 'expo-modules-core/src/uuid';

// Hermes uses Expo's installed native secure generator, not a crypto polyfill.
export const randomUUID = () => uuid.v4();
