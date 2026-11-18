import { NativeTabs } from 'expo-router/native-tabs';

import { useSystemColors } from '@/constants/theme';

export default function TabsLayout() {
  const c = useSystemColors();
  return (
    <NativeTabs backgroundColor={c.bg} labelStyle={{ selected: { color: c.label } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Scan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="barcode.viewfinder" src={require('@/assets/images/tabIcons/home.png')} renderingMode="template" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="rules">
        <NativeTabs.Trigger.Label>My Rules</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="slider.horizontal.3" src={require('@/assets/images/tabIcons/explore.png')} renderingMode="template" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
