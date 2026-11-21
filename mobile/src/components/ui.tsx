import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useCustomer } from '../lib/provider';
import { imageUrl, IS_TEST } from '../lib/config';
import { getUnitPrice } from '../../../lib/pricing';
import { counterDefaultSelection } from '../../../lib/counter-cart';
import type { Product } from '../../../types';
export const color = {
  ink: '#25271F',
  muted: '#7B7D70',
  paper: '#FAF8F1',
  red: '#E9402D',
  line: '#E8E4D9',
  green: '#406248',
};
export const money = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
export function Icon({
  name,
  size = 22,
  tint = color.ink,
}: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  size?: number;
  tint?: string;
}) {
  return <Ionicons name={name} size={size} color={tint} />;
}
export function Button({
  label,
  onPress,
  disabled = false,
  outline = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  outline?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        outline && s.outline,
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={[s.buttonText, outline && { color: color.ink }]}>{label}</Text>
    </Pressable>
  );
}
export function Page({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState(false);
  const store = useCustomer();
  return (
    <SafeAreaView style={s.page} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Image
          source={require('../../assets/restaurant-logo.gif')}
          style={{ width: 47, height: 42 }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose restaurant branch"
          onPress={() => setBranches(true)}
          disabled={!store.ready}
          style={{ flex: 1 }}
        >
          <Text style={s.eyebrow}>ORDERING FROM</Text>
          <View style={s.row}>
            <Text style={s.branch}>{store.branch?.name || 'Your neighbourhood'}</Text>
            <Icon name="chevron-down" size={15} />
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open your cart"
          onPress={() => router.push('/cart')}
          style={s.cartIcon}
        >
          <Icon name="bag-outline" />
          <Text style={s.cartBadge}>{store.cart.reduce((n, i) => n + i.quantity, 0)}</Text>
        </Pressable>
      </View>
      {IS_TEST && <Text style={s.test}>TEST APP · No real food or payment</Text>}
      {!!store.storageError && (
        <Text accessibilityRole="alert" style={s.error}>
          {store.storageError}
        </Text>
      )}
      {children}
      <Modal
        visible={branches}
        transparent
        animationType="fade"
        onRequestClose={() => setBranches(false)}
      >
        <View style={s.scrim}>
          <View style={s.sheet}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={s.title}>Choose your branch</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close branch selection"
                onPress={() => setBranches(false)}
              >
                <Icon name="close" />
              </Pressable>
            </View>
            <Text style={s.body}>Your order is prepared by this restaurant.</Text>
            {store.catalog?.branches.map((b) => (
              <Pressable
                key={b.id}
                accessibilityRole="button"
                style={[s.card, s.row]}
                onPress={() => {
                  try {
                    store.chooseBranch(b.id);
                    setBranches(false);
                  } catch (e) {
                    Alert.alert('Review your cart', String(e instanceof Error ? e.message : e));
                  }
                }}
              >
                <Icon name="location-outline" />
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{b.name}</Text>
                  <Text style={s.small}>{b.settings.address}</Text>
                </View>
                {b.id === store.branchId && <Icon name="checkmark-circle" tint={color.green} />}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
export function Loading() {
  const store = useCustomer();
  if (store.error)
    return (
      <View style={s.empty}>
        <Icon name="cloud-offline-outline" size={45} />
        <Text style={s.title}>Let’s reconnect.</Text>
        <Text style={s.body}>{store.error}</Text>
        <Button label="Try again" onPress={() => void store.refresh()} />
      </View>
    );
  return (
    <View style={s.empty}>
      <ActivityIndicator color={color.red} size="large" />
      <Text style={s.body}>Getting the freshest menu for you…</Text>
    </View>
  );
}
export function FoodCard({ product }: { product: Product }) {
  const store = useCustomer();
  let price: number | null = null;
  try {
    price = getUnitPrice(product, counterDefaultSelection(product));
  } catch {}
  const favourite = store.favourites.includes(product.id);
  return (
    <View style={s.food}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Customize ${product.name}`}
        onPress={() => router.push({ pathname: '/product/[id]', params: { id: product.id } })}
      >
        <Image source={{ uri: imageUrl(product.image) }} style={s.foodPhoto} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${favourite ? 'Unsave' : 'Save'} ${product.name}`}
        accessibilityState={{ selected: favourite }}
        onPress={() => store.favourite(product.id)}
        style={s.heart}
      >
        <Icon
          name={favourite ? 'heart' : 'heart-outline'}
          size={20}
          tint={favourite ? color.red : color.ink}
        />
      </Pressable>
      <View style={s.foodInfo}>
        <View style={s.row}>
          <Text style={{ fontSize: 13, color: color.green }}>
            {product.vegetarian ? '▣ VEG' : '▣ NON-VEG'}
          </Text>
          {product.bestseller && <Text style={s.tag}>BESTSELLER</Text>}
        </View>
        <Text style={s.cardTitle}>{product.name}</Text>
        <Text numberOfLines={2} style={s.small}>
          {product.description}
        </Text>
        <View style={[s.row, { justifyContent: 'space-between', marginTop: 12 }]}>
          <View>
            <Text style={s.price}>{price === null ? 'Unavailable' : money(price)}</Text>
            <Text style={s.caption}>{product.gstInclusive ? 'GST included' : 'before GST'}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${product.name}`}
            disabled={price === null}
            onPress={() => router.push({ pathname: '/product/[id]', params: { id: product.id } })}
            style={s.add}
          >
            <Text style={{ fontWeight: '800', color: color.red }}>ADD +</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.7, color: color.muted },
  branch: { fontSize: 15, fontWeight: '700', color: color.ink },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cartIcon: {
    position: 'relative',
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute',
    right: -2,
    top: -3,
    backgroundColor: color.red,
    color: 'white',
    borderRadius: 9,
    minWidth: 18,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '700',
    overflow: 'hidden',
  },
  test: {
    backgroundColor: '#F5E7CA',
    color: '#735320',
    textAlign: 'center',
    padding: 5,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  content: { padding: 22, paddingBottom: 38, gap: 16 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -1, color: color.ink },
  sectionTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.6, color: color.ink },
  body: { fontSize: 15, lineHeight: 23, color: color.muted },
  small: { fontSize: 13, lineHeight: 20, color: color.muted },
  caption: { fontSize: 10, color: color.muted, marginTop: 3 },
  card: {
    backgroundColor: '#FFF',
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.line,
    marginTop: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: color.ink, marginVertical: 5 },
  price: { fontSize: 18, fontWeight: '800', color: color.ink },
  button: {
    backgroundColor: color.red,
    paddingVertical: 16,
    paddingHorizontal: 22,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  buttonText: { fontSize: 15, color: 'white', fontWeight: '800' },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: color.line },
  empty: { flex: 1, padding: 30, alignItems: 'center', justifyContent: 'center', gap: 18 },
  error: { color: '#A12F23', backgroundColor: '#FCEBE5', padding: 14, fontSize: 13 },
  food: {
    backgroundColor: 'white',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.line,
    overflow: 'hidden',
    marginBottom: 18,
  },
  foodPhoto: { width: '100%', height: 185, backgroundColor: '#EEEAE0' },
  foodInfo: { padding: 18 },
  heart: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 9,
    backgroundColor: 'white',
    borderRadius: 22,
  },
  tag: {
    backgroundColor: '#FFF1D1',
    color: '#97651D',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 5,
  },
  add: {
    borderColor: '#F2BDB4',
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 20,
    borderRadius: 9,
    backgroundColor: '#FFF7F4',
  },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: color.paper, borderRadius: 24, padding: 24, maxHeight: '85%' },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 17,
    borderRadius: 22,
    backgroundColor: '#EFEBE0',
    marginRight: 8,
  },
  chipActive: { backgroundColor: color.ink },
  input: {
    borderColor: color.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 15,
    backgroundColor: 'white',
    fontSize: 15,
    color: color.ink,
  },
  divider: { height: 1, backgroundColor: color.line, marginVertical: 12 },
  link: { color: color.red, fontWeight: '700', fontSize: 14 },
  count: { fontSize: 18, fontWeight: '700', color: color.ink },
  quantityButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: 9,
    backgroundColor: 'white',
  },
  notice: { backgroundColor: '#E9EFE5', padding: 15, borderRadius: 12 },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderColor: color.line,
    backgroundColor: 'white',
    gap: 10,
  },
});
