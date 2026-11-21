import { Tabs } from 'expo-router';
import { useCustomer } from '../../lib/provider';
import { Icon, color } from '../../components/ui';
export default function TabLayout() {
  const { cart } = useCustomer();
  const count = cart.reduce((n, i) => n + i.quantity, 0);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.red,
        tabBarInactiveTintColor: color.muted,
        tabBarStyle: { backgroundColor: color.paper, borderTopColor: color.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color: tint }) => (
            <Icon name="home-outline" tint={typeof tint === 'string' ? tint : color.ink} />
          ),
        }}
      />
      <Tabs.Screen
        name="menu"
        options={{
          title: 'Menu',
          tabBarIcon: ({ color: tint }) => (
            <Icon name="restaurant-outline" tint={typeof tint === 'string' ? tint : color.ink} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: ({ color: tint }) => (
            <Icon name="heart-outline" tint={typeof tint === 'string' ? tint : color.ink} />
          ),
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          tabBarBadge: count || undefined,
          tabBarIcon: ({ color: tint }) => (
            <Icon name="bag-outline" tint={typeof tint === 'string' ? tint : color.ink} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'You',
          tabBarIcon: ({ color: tint }) => (
            <Icon name="person-outline" tint={typeof tint === 'string' ? tint : color.ink} />
          ),
        }}
      />
    </Tabs>
  );
}
