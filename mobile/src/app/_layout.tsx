import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CustomerProvider } from '../lib/provider';
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CustomerProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="product/[id]" options={{ presentation: 'modal' }} />
        </Stack>
      </CustomerProvider>
    </SafeAreaProvider>
  );
}
