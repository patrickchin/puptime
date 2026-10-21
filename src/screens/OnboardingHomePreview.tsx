import {MaterialCommunityIcons} from '@expo/vector-icons';
import type {Dispatch,SetStateAction} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';

import {createEvent,type PuppyEvent} from '../domain';
import type {Theme} from '../theme';
import {LogScreen} from './LogScreen';

export type PreviewGuide='quick'|'logged'|null;

// Use the actual log screen and editor. Preview records stay in the parent draft.
export function OnboardingHomePreview({theme,pup,events,setEvents,guide,setGuide,onReview}:{
  theme:Theme;pup:string;events:PuppyEvent[];setEvents:Dispatch<SetStateAction<PuppyEvent[]>>;
  guide:PreviewGuide;setGuide:Dispatch<SetStateAction<PreviewGuide>>;onReview:()=>void;
}){
  const dismiss=<Pressable testID="preview.guide.dismiss" accessibilityRole="button" onPress={()=>setGuide(null)} style={styles.dismiss}>
    <Text style={[styles.dismissText,{color:theme.onPrimary}]}>{guide==='quick'?'Nothing yet—I’ll come back':'I’ve got it'}</Text>
  </Pressable>;
  const bubble=(title:string,body:string)=><View testID="preview.guide" accessibilityLiveRegion="polite" style={[styles.bubble,{backgroundColor:theme.primary}]}>
    <Text style={[styles.title,{color:theme.onPrimary}]}>{title}</Text>
    <Text style={[styles.body,{color:theme.onPrimary}]}>{body}</Text>{dismiss}
  </View>;
  return <View style={styles.root}>
    <View style={styles.topbar}>
      <Text style={[styles.pup,{color:theme.text}]}>{pup==='your pup'?'Your puppy’s day':`${pup}’s day`}</Text>
      <Pressable testID="preview.review" accessibilityRole="button" accessibilityLabel="Review our plan" onPress={onReview} style={styles.review}>
        <MaterialCommunityIcons accessible={false} name="calendar-outline" color={theme.primary} size={20}/><Text style={[styles.reviewText,{color:theme.primary}]}>Our plan</Text>
      </Pressable>
    </View>
    <LogScreen theme={theme} events={events} customActivities={[]} showHeader={false} onOpenSettings={onReview}
      quickActionsHelp={guide==='quick'?<View style={styles.anchor}>
        <View style={[styles.pointer,{borderBottomColor:theme.primary}]}/>
        {bubble('Anything just happened?','Tap Pee, Poop or Eat above. It saves the time for you.')}
      </View>:undefined}
      onLog={async(type,label)=>{const event=createEvent(type,'app',Date.now(),label);setEvents(current=>[event,...current]);if(guide==='quick')setGuide('logged');}}
      onSave={async(event,changes)=>setEvents(current=>current.map(item=>item.id===event.id?{...item,...changes}:item))}
      onDelete={async event=>setEvents(current=>current.filter(item=>item.id!==event.id))}/>
    {guide==='logged'?<View style={styles.logged}>
      {bubble('Got it. That’s logged.','Tap the entry if you need to change the time or add a note.')}
    </View>:null}
  </View>;
}

const styles=StyleSheet.create({
  root:{flex:1},topbar:{minHeight:56,paddingHorizontal:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  pup:{fontFamily:'RedHatTextSemiBold',fontSize:17,flex:1},review:{minHeight:44,flexDirection:'row',alignItems:'center',gap:6},reviewText:{fontFamily:'RedHatText',fontSize:14},
  anchor:{zIndex:10,paddingTop:12},pointer:{position:'absolute',top:2,left:34,borderLeftWidth:10,borderRightWidth:10,borderBottomWidth:12,borderLeftColor:'transparent',borderRightColor:'transparent'},
  bubble:{borderRadius:20,padding:20,gap:10},title:{fontFamily:'RedHatDisplayBold',fontSize:22,lineHeight:28},body:{fontFamily:'RedHatText',fontSize:15,lineHeight:23},
  dismiss:{minHeight:44,alignSelf:'flex-start',justifyContent:'center',marginTop:2},dismissText:{fontFamily:'RedHatTextSemiBold',fontSize:14,textDecorationLine:'underline'},
  logged:{position:'absolute',left:18,right:18,bottom:18},
});
