import {ActivityIndicator,Pressable,Text,View} from 'react-native';
import {useLocalization} from '../localization-context';
import type {Theme} from '../theme';

export function ActivityLoadState({loading,error,onRetry,theme}:{loading:boolean;error:boolean;onRetry:()=>void;theme:Theme}){
 const {t}=useLocalization();
 if(error)return <Pressable testID="activity.retry" accessibilityRole="button" onPress={onRetry} style={{minHeight:48,padding:12,justifyContent:'center',alignItems:'center'}}><Text style={{fontSize:16,color:theme.primary,textAlign:'center'}}>{t('activity.loadError')} · {t('activity.retry')}</Text></Pressable>;
 if(loading)return <View testID="activity.loading" accessible accessibilityRole="progressbar" accessibilityLabel={t('activity.loading')} style={{minHeight:48,padding:12,flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center'}}><ActivityIndicator color={theme.primary}/><Text style={{fontSize:16,color:theme.textMuted}}>{t('activity.loading')}</Text></View>;
 return null;
}
