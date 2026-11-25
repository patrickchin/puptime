import {Fragment,type ReactNode} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {useLocalization} from '../localization-context';
import {spacing,surfaceTreatment,type Theme} from '../theme';

type GroupRow = {key:string; visible:boolean; content:ReactNode};

export function SettingsGroup({label,theme,rows}:{label:string;theme:Theme;rows:GroupRow[]}) {
  const {locale}=useLocalization();
  const first=rows.find(row=>row.visible);
  return <View style={!first&&styles.hidden}>
    <Text accessibilityRole="header" maxFontSizeMultiplier={2}
      style={[styles.label,{color:theme.primary,letterSpacing:theme.presentation.eyebrowTracking}]}>
      {label.toLocaleUpperCase(locale)}
    </Text>
    <View style={[styles.card,surfaceTreatment(theme),{
      backgroundColor:theme.surfaceRaised,borderColor:theme.border,borderRadius:theme.presentation.cardRadius,
    }]}>
      {rows.map(row=><Fragment key={row.key}>
        {row.visible&&row!==first?<View style={[styles.divider,{backgroundColor:theme.border}]}/>:null}
        <View style={!row.visible&&styles.hidden}>{row.content}</View>
      </Fragment>)}
    </View>
  </View>;
}

const styles=StyleSheet.create({
  hidden:{display:'none'},
  label:{fontSize:11,lineHeight:15,fontWeight:'800',marginTop:spacing.md,marginBottom:spacing.sm},
  card:{borderWidth:1,padding:spacing.sm,marginBottom:spacing.sm},
  divider:{height:StyleSheet.hairlineWidth,marginHorizontal:spacing.sm},
});
