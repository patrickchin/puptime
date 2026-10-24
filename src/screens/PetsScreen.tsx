import {ScrollView,StyleSheet,Text} from 'react-native';
import {PuppyNameSetting} from '../components/PuppyNameSetting';
import type {CloudHandle} from '../cloud/handle';
import {useLocalization} from '../localization-context';
import {spacing,type Theme} from '../theme';

// The production journal still owns one pet. Keep its real profile together;
// additional-pet creation remains in the separate in-memory design preview.
export function PetsScreen({theme,cloud,eventCount}:{theme:Theme;cloud:CloudHandle;eventCount:number}){
 const {t,locale}=useLocalization();
 return <ScrollView testID="screen.pets" contentContainerStyle={styles.content}>
  <PuppyNameSetting theme={theme} cloud={cloud}/>
  <Text style={[styles.count,{color:theme.textMuted}]}>{t(eventCount===1?'account.logsOne':'account.logsMany',{count:new Intl.NumberFormat(locale).format(eventCount)})}</Text>
 </ScrollView>;
}
const styles=StyleSheet.create({content:{width:'100%',maxWidth:720,alignSelf:'center',padding:spacing.md},count:{fontSize:15,lineHeight:22,paddingHorizontal:8}});
