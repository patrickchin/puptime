// Verification entry only. Read this file on the dedicated emulator after
// opening the editor and typing; unchanged rows must retain their counts.
import {registerRootComponent} from 'expo';
import {File,Paths} from 'expo-file-system';
import {MultiPetDesignPreview} from '../../src/screens/MultiPetDesignPreview';
const counts:Record<string,number>={};
const file=new File(Paths.document,'multi-pet-row-renders.json');
let pending=false;
function record(key:string){
  counts[key]=(counts[key]??0)+1;
  if(!pending){pending=true;setTimeout(()=>{file.create({overwrite:true});file.write(JSON.stringify(counts));pending=false;},0);}
}
registerRootComponent(function Probe(){return <MultiPetDesignPreview onRowRender={record}/>;});
