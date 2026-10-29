import {MaterialCommunityIcons} from '@expo/vector-icons';
import {memo} from 'react';
import {StyleSheet,Text,View,useWindowDimensions} from 'react-native';
import {Pressable} from './TelemetryPressable';
import type {ScheduleStatusItem} from '../analytics';
import {formatMinutes,formatScheduleWindow,type ScheduleEntry} from '../domain';
import {useLocalization} from '../localization-context';
import type {Theme} from '../theme';
import {ActivityIcon} from './ActivityIcon';

export const RoutineTimeline=memo(function RoutineTimeline({statuses,now,theme,setup=false,readOnly=false,onEdit,onRemove}:{
 statuses:ScheduleStatusItem[];now:number;theme:Theme;readOnly?:boolean;setup?:boolean;onEdit:(entry:ScheduleEntry)=>void;onRemove:(entry:ScheduleEntry)=>void;
}){
 const {activityColors,activityLabel,locale,t}=useLocalization();
 const {fontScale}=useWindowDimensions();
 const entries=[...statuses].sort((a,b)=>a.entry.minutes-b.entry.minutes);
 if(!entries.length)return null;
 const date=new Date(now),currentMinute=date.getHours()*60+date.getMinutes();
 const nowIndex=entries.findIndex(item=>item.entry.minutes>currentMinute);
 const nowLine=<View testID="schedule.now" accessible accessibilityLabel={`${t('schedule.now')}, ${formatMinutes(currentMinute,locale)}`} style={styles.now}>
  <Text style={[styles.nowText,{color:theme.primary}]}>{t('schedule.now')} · {formatMinutes(currentMinute,locale)}</Text><View style={[styles.nowLine,{backgroundColor:theme.primary}]}/>
 </View>;
 return <View testID="schedule.timeline" style={[styles.list,{borderColor:theme.border,borderRadius:theme.presentation.controlRadius,backgroundColor:theme.surfaceRaised}]}>
  {entries.map(({entry,status},index)=>{
   const colors=activityColors(theme,entry),label=activityLabel(entry);
   const statusLabel=t(status==='done'?'schedule.status.logged':status==='due'?entry.toleranceMinutes!==undefined?'schedule.status.flexibleDue':'schedule.status.due':status==='missed'?'schedule.status.missed':'schedule.status.upcoming');
   return <View key={entry.id}>
    {!setup&&nowIndex===index?nowLine:null}
    <View style={[styles.entry,{borderTopWidth:index>0?StyleSheet.hairlineWidth:0,borderColor:theme.border}]}>
     <Pressable testID={`schedule.entry.${entry.type}`} accessibilityRole={readOnly?undefined:"button"} disabled={readOnly}
      accessibilityLabel={t('schedule.editA11y',{activity:label,time:entry.toleranceMinutes===undefined?formatMinutes(entry.minutes,locale):formatScheduleWindow(entry,locale),status:setup?'':statusLabel,reminder:entry.reminder?t('schedule.reminderOn'):''})}
      onPress={()=>onEdit(entry)} style={({pressed})=>[styles.edit,{backgroundColor:pressed?colors.softColor:undefined}]}>
      <Text style={[styles.time,{color:theme.textMuted,width:Math.max(76,68*Math.min(fontScale,1.5))}]}>{formatMinutes(entry.minutes,locale)}</Text>
      <ActivityIcon activity={entry} theme={theme} color={colors.color} size={20}/>
      <View style={styles.copy}>
       <Text style={[styles.title,{color:theme.text}]}>{label}</Text>
       {!setup||entry.toleranceMinutes!==undefined?<View style={styles.status}>
        {!setup&&status==='done'?<MaterialCommunityIcons accessible={false} name="check-circle-outline" size={14} color={theme.primary}/>:null}
        <Text style={[styles.statusText,{color:status==='done'?theme.primary:status==='due'?colors.color:theme.textMuted}]}>
         {[!setup?statusLabel:null,entry.toleranceMinutes!==undefined?formatScheduleWindow(entry,locale):null].filter(Boolean).join(' · ')}
        </Text>
       </View>:null}
      </View>
      {entry.reminder?<MaterialCommunityIcons accessible={false} name="bell-outline" size={14} color={theme.primary}/>:null}
     </Pressable>
     <Pressable testID={`schedule.entry.${entry.type}.remove`} accessibilityRole="button" accessibilityLabel={t('schedule.removeA11y',{activity:label,time:formatMinutes(entry.minutes,locale)})}
      onPress={()=>onRemove(entry)} style={({pressed})=>[styles.remove,{backgroundColor:pressed?theme.primarySoft:undefined}]}>
      <MaterialCommunityIcons accessible={false} name="close" size={18} color={theme.textMuted}/>
     </Pressable>
    </View>
   </View>;
  })}
  {!setup&&nowIndex===-1?nowLine:null}
 </View>;
});

export const RoutineDayPreview=memo(function RoutineDayPreview({statuses,now,theme}:{statuses:ScheduleStatusItem[];now:number;theme:Theme}){
 const {activityColors,activityLabel,locale,t}=useLocalization();
 const entries=[...statuses].sort((a,b)=>a.entry.minutes-b.entry.minutes);
 const date=new Date(now),currentMinute=date.getHours()*60+date.getMinutes();
 const activities=entries.filter(({entry},index)=>entries.findIndex(item=>item.entry.type===entry.type&&item.entry.customLabel===entry.customLabel)===index);
 return <View testID="schedule.dayPreview" style={styles.preview}>
  <Text accessibilityRole="header" style={[styles.previewTitle,{color:theme.text}]}>{t('timeline.title')}</Text>
  <View accessible accessibilityLabel={`${t('schedule.todayPlan')}. ${entries.map(({entry})=>`${activityLabel(entry)}, ${formatMinutes(entry.minutes,locale)}`).join('. ')}. ${t('schedule.now')}, ${formatMinutes(currentMinute,locale)}`}>
   <View style={styles.axis}>
    {[0,6,12,18,24].map(hour=><Text key={hour} maxFontSizeMultiplier={1.5} style={[styles.axisLabel,{color:theme.textMuted}]}>{hour===24?'24':hour.toString().padStart(2,'0')}</Text>)}
   </View>
   <View style={[styles.track,{backgroundColor:theme.surface,borderColor:theme.border}]}>
    {[6,12,18].map(hour=><View key={hour} style={[styles.gridLine,{left:`${hour/24*100}%`,backgroundColor:theme.border}]}/>)}
    {entries.map(({entry})=>{
     const sameTime=entries.filter(item=>item.entry.minutes===entry.minutes);
     const lane=sameTime.findIndex(item=>item.entry.id===entry.id);
     return <View key={entry.id} testID={`schedule.previewMark.${entry.id}`} style={[styles.mark,{backgroundColor:activityColors(theme,entry).color,left:`${entry.minutes/1440*100}%`,top:4+lane*32/sameTime.length,height:32/sameTime.length}]}/>;
    })}
    <View style={[styles.currentTime,{left:`${currentMinute/1440*100}%`,backgroundColor:theme.text}]}><View style={[styles.currentTimeHead,{backgroundColor:theme.text}]}/></View>
   </View>
  </View>
  <View style={styles.legend}>
   {activities.map(({entry})=><View key={entry.id} style={styles.legendItem}><ActivityIcon activity={entry} theme={theme} color={activityColors(theme,entry).color} size={14}/><Text style={[styles.statusText,{color:theme.textMuted}]}>{activityLabel(entry)}</Text></View>)}
  </View>
 </View>;
});

const styles=StyleSheet.create({
 list:{borderWidth:1,overflow:'hidden'},entry:{flexDirection:'row',alignItems:'center'},
 edit:{minHeight:56,flex:1,flexDirection:'row',alignItems:'center',paddingLeft:10,gap:8,paddingVertical:6},
 copy:{flex:1,minWidth:0,gap:1},time:{fontSize:12,lineHeight:18,fontVariant:['tabular-nums']},title:{fontSize:15,lineHeight:20,fontWeight:'700'},
 status:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:4},statusText:{fontSize:12,lineHeight:16,flexShrink:1},
 remove:{width:48,minHeight:48,alignItems:'center',justifyContent:'center',marginLeft:8},
 now:{flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:10,paddingVertical:6},nowText:{fontSize:12,lineHeight:18,fontWeight:'700',fontVariant:['tabular-nums'],flexShrink:1},nowLine:{height:1,flex:1},
 preview:{gap:8},previewTitle:{fontSize:16,lineHeight:22,fontWeight:'700'},axis:{flexDirection:'row',justifyContent:'space-between',marginBottom:4},axisLabel:{fontSize:11,lineHeight:16,fontVariant:['tabular-nums']},
 track:{height:40,borderWidth:StyleSheet.hairlineWidth,borderRadius:4,marginHorizontal:7},gridLine:{position:'absolute',top:0,bottom:0,width:StyleSheet.hairlineWidth},mark:{position:'absolute',width:6,marginLeft:-3,borderRadius:2},
 currentTime:{position:'absolute',top:0,bottom:0,width:2,marginLeft:-1},currentTimeHead:{position:'absolute',top:-3,left:-2,width:6,height:6,borderRadius:3},
 legend:{flexDirection:'row',flexWrap:'wrap',gap:12},legendItem:{flexDirection:'row',alignItems:'center',gap:4},
});
