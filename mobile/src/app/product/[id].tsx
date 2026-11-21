import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCustomer } from '../../lib/provider';
import { imageUrl } from '../../lib/config';
import { Button, Icon, Loading, Page, color, money, s } from '../../components/ui';
import { getOptionPrice, getUnitPrice } from '../../../../lib/pricing';
import type { Product } from '../../../../types';
export default function ProductPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useCustomer();
  const product = store.catalog?.products.find((p) => p.id === id && !p.archived);
  return (
    <Page>
      {!store.catalog ? (
        <Loading />
      ) : !product ? (
        <View style={s.empty}>
          <Text style={s.title}>This dish is no longer available.</Text>
          <Button label="Back to the menu" onPress={() => router.replace('/menu')} />
        </View>
      ) : (
        <ProductForm key={product.id} product={product} />
      )}
    </Page>
  );
}
function ProductForm({ product }: { product: Product }) {
  const store = useCustomer();
  const insets = useSafeAreaInsets();
  const [selection, setSelection] = useState(() => ({
    productId: product.id,
    sizeId: product.sizes[0]?.id,
    crustId: product.crusts[0]?.id,
    toppingIds: [] as string[],
    quantity: 1,
    notes: '',
  }));
  let price = 0;
  let error = '';
  try {
    price = getUnitPrice(product, selection);
  } catch (e) {
    error = e instanceof Error ? e.message : 'This item is unavailable.';
  }
  return (
    <>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))}
          style={s.row}
        >
          <Icon name="arrow-back" />
          <Text style={s.link}>Back to menu</Text>
        </Pressable>
        <Image
          source={{ uri: imageUrl(product.image) }}
          style={{ width: '100%', height: 240, borderRadius: 22, backgroundColor: color.line }}
        />
        <Text style={[s.eyebrow, { color: color.green }]}>
          {product.vegetarian ? 'VEGETARIAN' : 'NON-VEGETARIAN'}
        </Text>
        <Text style={s.title}>{product.name}</Text>
        <Text style={s.body}>{product.description}</Text>
        {(['sizes', 'crusts'] as const).map(
          (group) =>
            product[group].length > 0 && (
              <View key={group}>
                <Text style={s.sectionTitle}>
                  {group === 'sizes' ? 'Choose your size' : 'Choose your crust'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
                  {product[group].map((option) => {
                    const field = group === 'sizes' ? 'sizeId' : 'crustId';
                    const selected = selection[field] === option.id;
                    return (
                      <Pressable
                        key={option.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => setSelection({ ...selection, [field]: option.id })}
                        style={[s.chip, selected && s.chipActive]}
                      >
                        <Text style={{ color: selected ? 'white' : color.ink, fontWeight: '600' }}>
                          {option.name} ·{' '}
                          {money(
                            group === 'sizes'
                              ? option.price
                              : getOptionPrice(option, selection.sizeId),
                          )}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ),
        )}
        {!!product.toppings.length && (
          <View>
            <Text style={s.sectionTitle}>Make it your own</Text>
            <Text style={s.small}>Optional extras</Text>
            {product.toppings.map((option) => (
              <Pressable
                key={option.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selection.toppingIds.includes(option.id) }}
                onPress={() =>
                  setSelection({
                    ...selection,
                    toppingIds: selection.toppingIds.includes(option.id)
                      ? selection.toppingIds.filter((id) => id !== option.id)
                      : [...selection.toppingIds, option.id],
                  })
                }
                style={[
                  s.row,
                  {
                    justifyContent: 'space-between',
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderColor: color.line,
                  },
                ]}
              >
                <View style={s.row}>
                  <Icon
                    name={selection.toppingIds.includes(option.id) ? 'checkbox' : 'square-outline'}
                    tint={color.red}
                  />
                  <Text style={s.body}>{option.name}</Text>
                </View>
                <Text style={s.price}>+{money(getOptionPrice(option, selection.sizeId))}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={s.sectionTitle}>A note for the kitchen</Text>
        <TextInput
          accessibilityLabel="Preparation note"
          multiline
          maxLength={300}
          value={selection.notes}
          onChangeText={(notes) => setSelection({ ...selection, notes })}
          placeholder="Anything we should know? (optional)"
          placeholderTextColor={color.muted}
          style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
        />
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Text style={s.sectionTitle}>Quantity</Text>
          <View style={s.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reduce quantity"
              disabled={selection.quantity <= 1}
              onPress={() => setSelection({ ...selection, quantity: selection.quantity - 1 })}
              style={s.quantityButton}
            >
              <Icon name="remove" />
            </Pressable>
            <Text style={s.count}>{selection.quantity}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase quantity"
              disabled={selection.quantity >= 20}
              onPress={() => setSelection({ ...selection, quantity: selection.quantity + 1 })}
              style={s.quantityButton}
            >
              <Icon name="add" />
            </Pressable>
          </View>
        </View>
        {!!error && <Text style={s.error}>{error}</Text>}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: Math.max(20, insets.bottom) }]}>
        <Text style={s.small}>
          {product.gstInclusive
            ? 'Price includes GST.'
            : 'GST and delivery are calculated at checkout.'}
        </Text>
        <Button
          disabled={!!error || !store.ready}
          label={`Add to cart · ${money(price * selection.quantity)}`}
          onPress={() => {
            try {
              store.add(selection);
              if (router.canGoBack()) router.back();
              else router.replace('/cart');
            } catch (e) {
              Alert.alert(
                'Unable to add item',
                e instanceof Error ? e.message : 'Please try again.',
              );
            }
          }}
        />
      </View>
    </>
  );
}
