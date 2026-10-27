import {MaterialCommunityIcons} from '@expo/vector-icons';
import {memo} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import type {ScheduleStatusItem} from '../analytics';
import {formatMinutes,formatScheduleWindow,type ScheduleEntry} from '../domain';
import {useLocalization} from '../localization-context';
import type {Theme} from '../theme';
import {ActivityIcon} from './ActivityIcon';

export const RoutineTimeline=memo(function RoutineTimeline({statuses,now,theme,setup=false,onEdit,onRemove}:{
 statuses:ScheduleStatusItem[];now:number;theme:Theme;setup?:boolean;onEdit:(entry:ScheduleEntry)=>void;onRemove:(entry:ScheduleEntry)=>void;
}){
 const {activityColors,activityLabel,locale,t}=useLocalization();
 const entries=[...statuses].sort((a,b)=>a.entry.minutes-b.entry.minutes);
 if(!entries.length)return null;
 const firstHour=Math.floor(entries[0].entry.minutes/60),lastHour=Math.floor(entries[entries.length-1].entry.minutes/60);
 const date=new Date(now),currentMinute=date.getHours()*60+date.getMinutes();
 return <View testID="schedule.timeline">
  {Array.from({length:lastHour-firstHour+1},(_,index)=>firstHour+index).map(hour=>{
   const items=entries.filter(item=>Math.floor(item.entry.minutes/60)===hour);
   const current=!setup&&date.getHours()===hour;
   const nowLine=<View key="now" testID="schedule.now" accessible accessibilityLabel={`${t('schedule.now')}, ${formatMinutes(currentMinute,locale)}`} style={styles.now}>
    <Text style={[styles.nowText,{color:theme.primary}]}>{t('schedule.now')} · {formatMinutes(currentMinute,locale)}</Text><View style={[styles.nowLine,{backgroundColor:theme.primary}]}/>
   </View>;
   const nowIndex=items.findIndex(item=>item.entry.minutes>currentMinute);
   return <View key={hour} style={styles.hour}>
    <Text maxFontSizeMultiplier={1.5} style={[styles.hourLabel,{color:theme.textMuted}]}>{formatMinutes(hour*60,locale)}</Text>
    <View style={[styles.hourContent,{borderColor:theme.border}]}>
     {items.map(({entry,status},index)=>{
      const colors=activityColors(theme,entry),label=activityLabel(entry);
      const statusLabel=t(status==='done'?'schedule.status.logged':status==='due'?entry.toleranceMinutes!==undefined?'schedule.status.flexibleDue':'schedule.status.due':status==='missed'?'schedule.status.missed':'schedule.status.upcoming');
      return <View key={entry.id}>
       {current&&nowIndex===index?nowLine:null}
       <Pressable testID={`schedule.entry.${entry.type}`} accessibilityRole="button"
        accessibilityLabel={t('schedule.editA11y',{activity:label,time:entry.toleranceMinutes===undefined?formatMinutes(entry.minutes,locale):formatScheduleWindow(entry,locale),status:setup?'':statusLabel,reminder:entry.reminder?t('schedule.reminderOn'):''})}
        onPress={()=>onEdit(entry)} style={({pressed})=>[styles.entry,{backgroundColor:pressed?colors.softColor:theme.surfaceRaised,borderColor:theme.border,borderLeftColor:colors.color,borderRadius:theme.presentation.controlRadius}]}>
        <View style={[styles.icon,{backgroundColor:colors.softColor}]}><ActivityIcon activity={entry} theme={theme} color={colors.color} size={21}/></View>
        <View style={styles.copy}>
         <Text style={[styles.time,{color:theme.textMuted}]}>{entry.toleranceMinutes===undefined?formatMinutes(entry.minutes,locale):formatScheduleWindow(entry,locale)}</Text>
         <Text style={[styles.title,{color:theme.text}]}>{label}</Text>
         {!setup?<View style={styles.status}>
          {status==='done'?<MaterialCommunityIcons accessible={false} name="check-circle-outline" size={14} color={theme.primary}/>:null}
          <Text style={[styles.statusText,{color:status==='done'?theme.primary:status==='due'?colors.color:theme.textMuted}]}>{statusLabel}</Text>
          {entry.reminder?<MaterialCommunityIcons accessible={false} name="bell-outline" size={14} color={theme.primary}/>:null}
         </View>:null}
        </View>
        <Pressable testID={`schedule.entry.${entry.type}.remove`} accessibilityRole="button" accessibilityLabel={t('schedule.removeA11y',{activity:label,time:formatMinutes(entry.minutes,locale)})}
         onPress={event=>{event.stopPropagation();onRemove(entry);}} style={({pressed})=>[styles.remove,{backgroundColor:pressed?theme.primarySoft:undefined,borderRadius:theme.presentation.controlRadius}]}>
         <MaterialCommunityIcons accessible={false} name="close" size={20} color={theme.textMuted}/>
        </Pressable>
       </Pressable>
      </View>;
     })}
     {current&&nowIndex===-1?nowLine:null}
    </View>
   </View>;
  })}
 </View>;
});
const styles=StyleSheet.create({
 hour:{flexDirection:'row',minHeight:80},hourLabel:{width:72,paddingTop:10,paddingRight:8,fontSize:12,lineHeight:18,fontVariant:['tabular-nums']},
 hourContent:{flex:1,minWidth:0,borderTopWidth:StyleSheet.hairlineWidth,borderLeftWidth:StyleSheet.hairlineWidth,paddingLeft:12,paddingTop:8,paddingBottom:16,gap:8},
 entry:{minHeight:88,borderWidth:1,borderLeftWidth:3,paddingLeft:10,flexDirection:'row',alignItems:'center',gap:8},
 icon:{width:32,height:32,borderRadius:12,alignItems:'center',justifyContent:'center'},copy:{flex:1,minWidth:0,paddingVertical:10,gap:3},
 time:{fontSize:12,lineHeight:18,fontVariant:['tabular-nums']},title:{fontSize:16,lineHeight:22,fontWeight:'700'},
 status:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:4},statusText:{fontSize:12,lineHeight:18,flexShrink:1},
 remove:{width:48,minHeight:48,alignItems:'center',justifyContent:'center'},
 now:{flexDirection:'row',alignItems:'center',gap:8,marginVertical:8},nowText:{fontSize:12,lineHeight:18,fontWeight:'700',fontVariant:['tabular-nums'],flexShrink:1},nowLine:{height:2,flex:1},
});
