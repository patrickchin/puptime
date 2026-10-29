import {ScrollView,StyleSheet,Text} from 'react-native';
import {PuppyNameSetting} from '../components/PuppyNameSetting';
import type {CloudHandle} from '../cloud/handle';
import {useLocalization} from '../localization-context';
import {spacing,type Theme} from '../theme';
import {AccountButton} from '../components/AccountSignIn';

// The production journal still owns one pet. Keep its real profile together;
// additional-pet creation remains in the separate in-memory design preview.
export function PetsScreen({theme,cloud,eventCount,onShare,onOpenShared}:{theme:Theme;cloud:CloudHandle;eventCount:number;onShare:()=>void;onOpenShared:()=>void}){
 const {t,locale}=useLocalization();
 return <ScrollView testID="screen.pets" contentContainerStyle={styles.content}>
  <PuppyNameSetting theme={theme} cloud={cloud}/>
  <Text style={[styles.count,{color:theme.textMuted}]}>{t(eventCount===1?'account.logsOne':'account.logsMany',{count:new Intl.NumberFormat(locale).format(eventCount)})}</Text>
  <AccountButton theme={theme} testID="puppy.share" label={t('sharing.title')} onPress={onShare}/>
  <AccountButton theme={theme} testID="puppy.shared" label={t('sharing.sharedTitle')} onPress={onOpenShared}/>
 </ScrollView>;
}
const styles=StyleSheet.create({content:{width:'100%',maxWidth:720,alignSelf:'center',padding:spacing.md},count:{fontSize:15,lineHeight:22,paddingHorizontal:8}});
