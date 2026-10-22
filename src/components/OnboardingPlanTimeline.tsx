import {StyleSheet,Text,View} from 'react-native';
import {formatMinutes,formatScheduleWindow,type ScheduleEntry} from '../domain';
import {useLocalization} from '../localization-context';
import {timelineExpectedWindows} from '../timeline-format';
import type {Theme} from '../theme';
import {ActivityIcon} from './ActivityIcon';

export function OnboardingPlanTimeline({schedule,theme}:{schedule:ScheduleEntry[];theme:Theme}){
  const {activityColors}=useLocalization();
  const windows=timelineExpectedWindows(schedule,['poop']);
  const mealColor=activityColors(theme,{type:'meal'}),poopColor=activityColors(theme,{type:'poop'});
  const description=schedule.map(entry=>`${entry.type==='meal'?'Meal':'Poop window'}: ${entry.type==='poop'?formatScheduleWindow(entry,'en'):formatMinutes(entry.minutes,'en')}`).join('. ');
  return <View testID="preview.planTimeline" accessible accessibilityLabel={`Daily plan, midnight to midnight. ${description||'No times chosen yet.'}`} style={[styles.card,{backgroundColor:theme.surface,borderColor:theme.border}]}>
    <Text style={[styles.day,{color:theme.text}]}>A day at a glance</Text>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.axis}>{['00:00','06:00','12:00','18:00','24:00'].map(time=><Text key={time} style={[styles.hour,{color:theme.textMuted}]}>{time}</Text>)}</View>
      <View style={[styles.track,{borderColor:theme.border}]}>
        {Array.from({length:25},(_,hour)=><View key={hour} style={[styles.grid,{left:`${hour/24*100}%`,backgroundColor:theme.border,opacity:hour%6===0?1:.35}]}/>)}
        {windows.map(window=><View key={`${window.id}-${window.start}`} style={[styles.window,{left:`${window.start/1440*100}%`,width:`${(window.end-window.start)/1440*100}%`,backgroundColor:poopColor.color}]}/>)}
        {schedule.filter(entry=>entry.type==='meal').map(entry=><View key={entry.id} style={[styles.meal,{left:`${entry.minutes/1440*100}%`,backgroundColor:mealColor.color}]}/>)}
      </View>
      <View style={styles.legend}>
        <View style={styles.key}><ActivityIcon activity={{type:'meal'}} theme={theme} color={mealColor.color} size={18}/><Text style={[styles.keyText,{color:theme.text}]}>Meal</Text></View>
        <View style={styles.key}><ActivityIcon activity={{type:'poop'}} theme={theme} color={poopColor.color} size={18}/><Text style={[styles.keyText,{color:theme.text}]}>Poop window</Text></View>
      </View>
    </View>
  </View>;
}
const styles=StyleSheet.create({
  card:{padding:16,borderRadius:18,borderWidth:1,gap:16},day:{fontSize:16,lineHeight:22,fontWeight:'600'},
  axis:{flexDirection:'row',justifyContent:'space-between',paddingBottom:8},hour:{fontSize:10,fontVariant:['tabular-nums']},
  track:{height:64,borderTopWidth:StyleSheet.hairlineWidth,borderBottomWidth:StyleSheet.hairlineWidth,position:'relative',overflow:'hidden'},
  grid:{position:'absolute',top:0,bottom:0,width:StyleSheet.hairlineWidth},window:{position:'absolute',top:10,bottom:10,opacity:.55,borderRadius:3},meal:{position:'absolute',top:5,bottom:5,width:5,marginLeft:-2.5,borderRadius:3},
  legend:{flexDirection:'row',gap:20,paddingTop:12},key:{flexDirection:'row',alignItems:'center',gap:6},keyText:{fontSize:12,lineHeight:18},
});
