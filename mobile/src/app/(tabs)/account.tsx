import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useCustomer } from '../../lib/provider';
import { openCustomerUrl } from '../../lib/browser';
import { Button, Icon, Page, color, s } from '../../components/ui';
export default function Account() {
  const store = useCustomer();
  const open = (path: string) =>
    void openCustomerUrl(path).catch((e) =>
      Alert.alert('Unable to open page', e instanceof Error ? e.message : 'Please try again.'),
    );
  return (
    <Page>
      <ScrollView contentContainerStyle={s.content}>
        <View style={{ gap: 12, paddingVertical: 14 }}>
          <Icon name="person-circle-outline" size={64} tint={color.green} />
          <Text style={s.title}>Your pizza people.</Text>
          <Text style={s.body}>
            Sign in securely to see your orders, saved addresses and order updates.
          </Text>
          <Button label="Open my account" onPress={() => open('/account/profile')} />
        </View>
        <Text style={s.sectionTitle}>Everything in one place</Text>
        {[
          {
            title: 'My orders',
            description: 'Your receipts and order progress',
            icon: 'receipt-outline' as const,
            path: '/account/orders',
          },
          {
            title: 'Track an order',
            description: 'See what’s happening in the kitchen',
            icon: 'bicycle-outline' as const,
            path: '/track-order',
          },
          {
            title: 'Saved addresses',
            description: 'Your delivery details, kept securely',
            icon: 'location-outline' as const,
            path: '/account/addresses',
          },
          {
            title: 'Contact the restaurant',
            description: store.branch?.name || 'We’re here to help',
            icon: 'chatbubble-ellipses-outline' as const,
            path: '/contact',
          },
          {
            title: 'Privacy policy',
            description: 'How your information is handled',
            icon: 'shield-checkmark-outline' as const,
            path: '/privacy-policy',
          },
          {
            title: 'Refunds & cancellations',
            description: 'Payment and refund information',
            icon: 'arrow-undo-outline' as const,
            path: '/refund-cancellation',
          },
        ].map((item) => (
          <Pressable
            key={item.path}
            accessibilityRole="button"
            onPress={() => open(item.path)}
            style={[s.card, s.row]}
          >
            <Icon name={item.icon} tint={color.green} />
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle}>{item.title}</Text>
              <Text style={s.small}>{item.description}</Text>
            </View>
            <Icon name="chevron-forward" size={18} />
          </Pressable>
        ))}
        <Text style={[s.caption, { textAlign: 'center', paddingVertical: 25 }]}>
          HOT PIZZA ACE · Make every day delicious.
        </Text>
      </ScrollView>
    </Page>
  );
}
