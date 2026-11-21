import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomer } from '../../lib/provider';
import { imageUrl } from '../../lib/config';
import { openCustomerUrl } from '../../lib/browser';
import { encodeMobileCart, validateMobileCart } from '../../../../lib/mobile-cart';
import { getItemOptions, getUnitPrice } from '../../../../lib/pricing';
import { isBranchOpen } from '../../../../lib/branches';
import { Button, Icon, Loading, Page, color, money, s } from '../../components/ui';
export default function Cart() {
  const store = useCustomer();
  const [opening, setOpening] = useState(false);
  const lines = store.cart.map((line) => {
    const product = store.catalog?.products.find((p) => p.id === line.productId);
    let price = 0,
      options = '',
      error = '';
    try {
      if (!product) throw new Error('This item is no longer on the menu.');
      price = getUnitPrice(product, line);
      options = getItemOptions(product, line).join(' · ');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Please review this item.';
    }
    return { line, product, price, options, error };
  });
  const subtotal = lines.reduce((n, item) => n + item.price * item.line.quantity, 0);
  const errors = lines.map((item) => item.error).filter(Boolean);
  const open = !!store.branch && isBranchOpen(store.branch);
  return (
    <Page>
      {!store.catalog ? (
        <Loading />
      ) : !store.cart.length ? (
        <View style={s.empty}>
          <Icon name="bag-outline" size={58} tint={color.red} />
          <Text style={s.title}>Your cart is empty</Text>
          <Text style={[s.body, { textAlign: 'center' }]}>
            Browse the menu and add dishes to start your order.
          </Text>
          <Button label="Explore the menu" onPress={() => router.push('/menu')} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={s.content}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={s.title}>Your cart</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear cart"
                onPress={() =>
                  Alert.alert('Clear your cart?', 'Remove all items from this phone’s cart?', [
                    { text: 'Keep items', style: 'cancel' },
                    { text: 'Clear cart', style: 'destructive', onPress: store.clear },
                  ])
                }
              >
                <Icon name="trash-outline" tint={color.muted} />
              </Pressable>
            </View>
            <Text style={s.body}>{store.branch?.name} · Freshly made for you</Text>
            {lines.map(({ line, product, price, options }) => (
              <View key={line.id} style={s.card}>
                <View style={[s.row, { alignItems: 'flex-start' }]}>
                  <Image
                    source={{ uri: imageUrl(product?.image || '') }}
                    style={{ width: 82, height: 82, borderRadius: 12, backgroundColor: color.line }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle}>{product?.name || 'Unavailable item'}</Text>
                    <Text style={s.small}>{options}</Text>
                    {!!line.notes && <Text style={s.small}>{line.notes}</Text>}
                    <Text style={s.price}>{money(price * line.quantity)}</Text>
                  </View>
                </View>
                <View style={[s.row, { justifyContent: 'space-between', marginTop: 14 }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${product?.name || 'item'}`}
                    onPress={() => store.quantity(line.id, 0)}
                  >
                    <Text style={s.link}>Remove</Text>
                  </Pressable>
                  <View style={s.row}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Reduce ${product?.name || 'item'} quantity`}
                      style={s.quantityButton}
                      onPress={() => store.quantity(line.id, line.quantity - 1)}
                    >
                      <Icon name="remove" size={17} />
                    </Pressable>
                    <Text style={s.count}>{line.quantity}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Increase ${product?.name || 'item'} quantity`}
                      disabled={line.quantity >= 20}
                      style={s.quantityButton}
                      onPress={() => store.quantity(line.id, line.quantity + 1)}
                    >
                      <Icon name="add" size={17} />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
            <View style={s.card}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.body}>Items subtotal</Text>
                <Text style={s.price}>{money(subtotal)}</Text>
              </View>
              <View style={s.divider} />
              <Text style={s.small}>
                Final GST, delivery, discounts and payment methods are shown before you place the
                order. Login and payment continue securely on Hot Pizza Ace.
              </Text>
            </View>
            <View style={s.notice}>
              <Text style={[s.cardTitle, { color: color.green }]}>Order from Hot Pizza Ace</Text>
              <Text style={s.body}>
                Orders placed through the app reach the restaurant’s existing counter and Kitchen.
              </Text>
            </View>
            {[
              ...errors,
              ...(store.error ? [store.error] : []),
              ...(!open
                ? ['This branch is currently paused. Refresh the menu or choose another branch.']
                : []),
            ].map((e, i) => (
              <Text accessibilityRole="alert" style={s.error} key={i}>
                {e}
              </Text>
            ))}
          </ScrollView>
          <View style={s.footer}>
            <Button
              disabled={!store.ready || errors.length > 0 || !open || opening}
              label={opening ? 'Opening secure checkout…' : 'Continue to checkout  →'}
              onPress={async () => {
                setOpening(true);
                try {
                  const proposal = validateMobileCart(
                    {
                      version: 1,
                      branchId: store.branchId,
                      items: store.cart.map(({ id: _id, ...selection }) => selection),
                    },
                    store.catalog!.products,
                    store.catalog!.branches.map((b) => b.id),
                  );
                  await openCustomerUrl(`/app-checkout#${encodeMobileCart(proposal)}`);
                } catch (e) {
                  Alert.alert(
                    'Checkout unavailable',
                    e instanceof Error ? e.message : 'Please try again.',
                  );
                } finally {
                  setOpening(false);
                }
              }}
            />
            <Text style={[s.caption, { textAlign: 'center' }]}>
              Your cart stays here until you clear it. No order is placed by opening checkout.
            </Text>
          </View>
        </>
      )}
    </Page>
  );
}
