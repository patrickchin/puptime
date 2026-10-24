// Verification entry only. Read this file on the dedicated emulator after
// opening the editor and typing; unchanged rows must retain their counts.
import {registerRootComponent} from 'expo';
import {File,Paths} from 'expo-file-system';
import {MultiPetDesignPreview} from '../../src/screens/MultiPetDesignPreview';
const counts={renders:{} as Record<string,number>,mounts:{} as Record<string,number>,updates:{} as Record<string,number>};
const file=new File(Paths.document,'multi-pet-row-renders.json');
let pending=false;
function record(key:string,phase:'mount'|'update'){
  counts.renders[key]=(counts.renders[key]??0)+1;
  counts.updates[key]??=0;
  const target=phase==='mount'?counts.mounts:counts.updates;
  target[key]=(target[key]??0)+1;
  if(!pending){pending=true;setTimeout(()=>{file.create({overwrite:true});file.write(JSON.stringify(counts));pending=false;},0);}
}
registerRootComponent(function Probe(){return <MultiPetDesignPreview onRowRender={record}/>;});
