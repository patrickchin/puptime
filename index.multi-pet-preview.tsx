// Deliberately separate from index.ts: sample data, no account or journal writes.
import {registerRootComponent} from 'expo';
import {MultiPetDesignPreview} from './src/screens/MultiPetDesignPreview';
registerRootComponent(function PreviewApp(){return <MultiPetDesignPreview/>;});
