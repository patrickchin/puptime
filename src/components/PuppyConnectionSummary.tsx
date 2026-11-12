import {Platform,StyleSheet,Text,View} from 'react-native';
import {useLocalization} from '../localization-context';
import type {Theme} from '../theme';
import {PuppyIdentity} from './PuppyIdentity';

export function PuppyConnectionSummary({phone,cloud,email,theme}:{phone:{name:string;eventCount:number|null;lastActivityAt:number|null};cloud:{name:string;eventCount:number};email:string;theme:Theme}) {
  const {t,locale}=useLocalization();
  const count=(value:number)=>t(value===1?'account.logsOne':'account.logsMany',{count:new Intl.NumberFormat(locale).format(value)});
  const name=phone.name==='My puppy'?t('account.defaultName'):phone.name;
  const body=[styles.body,{color:theme.textMuted}];
  return <View testID="account.connection.summary" style={styles.stack}>
    <View testID="account.connection.phone" style={styles.history}>
      <Text accessibilityRole="header" style={[styles.label,{color:theme.textMuted}]}>{t(Platform.OS==='ios'&&Platform.isPad?'account.onDevice':'account.onPhone')}</Text>
      <View style={styles.identity}><PuppyIdentity theme={theme}/><Text testID="account.connection.phone.name" style={[styles.name,styles.grow,{color:theme.text,fontFamily:theme.presentation.headingFont}]}>{name}</Text></View>
      <Text testID="account.connection.phone.count" style={body}>{phone.eventCount===null?t('account.historyLoading'):count(phone.eventCount)}</Text>
      {phone.lastActivityAt!==null?<Text style={body}>{t('account.latestActivity',{date:new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(phone.lastActivityAt)})}</Text>:null}
    </View>
    <View testID="account.connection.cloud" style={[styles.history,styles.cloud,{borderColor:theme.border}]}>
      <Text accessibilityRole="header" style={[styles.label,{color:theme.textMuted}]}>{t('account.inCloud')}</Text>
      <Text testID="account.connection.cloud.name" style={[styles.name,{color:theme.text,fontFamily:theme.presentation.headingFont}]}>{cloud.name}</Text>
      <Text testID="account.connection.cloud.count" style={body}>{count(cloud.eventCount)}</Text>
      <Text style={body}>{email}</Text>
    </View>
  </View>;
}
const styles=StyleSheet.create({stack:{gap:16},identity:{flexDirection:'row',alignItems:'center',gap:12},grow:{flex:1},history:{gap:5},cloud:{borderTopWidth:1,paddingTop:16},label:{fontSize:15,lineHeight:22,fontWeight:'600'},name:{fontSize:23,lineHeight:30,fontWeight:'700'},body:{fontSize:16,lineHeight:24}});
