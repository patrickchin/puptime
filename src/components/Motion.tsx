import {useEffect,useRef,useState,type ReactNode} from 'react';
import {AccessibilityInfo,Animated,AppState,Easing,Modal,Platform,StyleSheet,View,useWindowDimensions,type ModalProps} from 'react-native';

export function useReducedMotion(){
 const [reduced,setReduced]=useState(true);
 useEffect(()=>{
  let active=true;
  const refresh=()=>{void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(active)setReduced(value);}).catch(()=>undefined);};
  refresh();
  const motion=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
  const foreground=AppState.addEventListener('change',state=>{if(state==='active')refresh();});
  return()=>{active=false;motion.remove();foreground.remove();};
 },[]);
 return reduced;
}

export function SheetModal({visible=false,children,backdropOpacity=.56,...props}:Omit<ModalProps,'animationType'>&{backdropOpacity?:number}){
 const reduced=useReducedMotion();
 const {height}=useWindowDimensions();
 const [presented,setPresented]=useState(visible);
 const progress=useRef(new Animated.Value(visible?1:0)).current;
 const lastVisibleChildren=useRef(children),isVisible=useRef(visible);isVisible.current=visible;
 // Keep form values intact until dismissal finishes; do not remount the history.
 if(visible)lastVisibleChildren.current=children;
 const animate=(toValue:number)=>{
  progress.stopAnimation();
  if(reduced){progress.setValue(toValue);if(!toValue)setPresented(false);return;}
  Animated.timing(progress,{toValue,duration:toValue?280:220,easing:toValue?Easing.out(Easing.cubic):Easing.in(Easing.cubic),useNativeDriver:Platform.OS!=='web',isInteraction:false})
   .start(({finished})=>{if(finished&&!toValue&&!isVisible.current)setPresented(false);});
 };
 useEffect(()=>{
  if(reduced){progress.stopAnimation();progress.setValue(visible?1:0);setPresented(visible);}
  else if(visible){if(!presented){progress.setValue(0);setPresented(true);}else animate(1);}
  else if(presented)animate(0);
  return()=>progress.stopAnimation();
 },[visible,reduced,progress]);
 // The portal stays still: animate the sheet and backdrop separately below.
 return <Modal {...props} visible={presented} animationType="none"
  onShow={event=>{if(isVisible.current)animate(1);props.onShow?.(event);}}
  onDismiss={()=>{if(!isVisible.current)lastVisibleChildren.current=null;props.onDismiss?.();}}>
  <View style={styles.fill} pointerEvents={visible?'auto':'none'}>
   <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:`rgba(0,0,0,${backdropOpacity})`,opacity:progress}]}/>
   <Animated.View style={[styles.fill,{transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[height,0]})}]}]}>
    {visible?children:lastVisibleChildren.current}
   </Animated.View>
  </View>
 </Modal>;
}

export function ScreenTransition({screenKey,children}:{screenKey:string;children:ReactNode}){
 const reduced=useReducedMotion(),progress=useRef(new Animated.Value(1)).current,previous=useRef(screenKey);
 useEffect(()=>{
  const changed=previous.current!==screenKey;previous.current=screenKey;
  progress.stopAnimation();
  if(reduced||Platform.OS==='web'||!changed){progress.setValue(1);return;}
  progress.setValue(.35);
  const animation=Animated.timing(progress,{toValue:1,duration:180,easing:Easing.out(Easing.cubic),useNativeDriver:true,isInteraction:false});
  animation.start();
  return()=>animation.stop();
 },[screenKey,reduced,progress]);
 // No key/remount or frame-by-frame React state updates: history stays intact.
 return <Animated.View style={[styles.fill,{opacity:progress}]}>{children}</Animated.View>;
}

const styles=StyleSheet.create({fill:{flex:1}});
