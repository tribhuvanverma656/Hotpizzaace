import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useCustomer } from '../../lib/provider';
import { FoodCard, Loading, Page, color, s } from '../../components/ui';
import { FoodCategoryIcon } from '../../components/food-category-icon';
export default function Menu() {
  const store = useCustomer();
  const params = useLocalSearchParams<{ category?: string }>();
  const category = params.category || 'all';
  const [search, setSearch] = useState('');
  const products = (store.catalog?.products || []).filter(
    (p) =>
      !p.archived &&
      (category === 'all' || p.categoryId === category) &&
      `${p.name} ${p.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <Page>
      {!store.catalog ? (
        <Loading />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <FoodCard product={item} />}
          contentContainerStyle={s.content}
          refreshing={store.loading}
          onRefresh={() => void store.refresh()}
          ListHeaderComponent={
            <View style={{ gap: 16, marginBottom: 20 }}>
              <Text style={s.title}>Our menu</Text>
              <TextInput
                accessibilityLabel="Search the menu"
                value={search}
                onChangeText={setSearch}
                placeholder="Search pizza, sides or drinks…"
                placeholderTextColor={color.muted}
                style={s.input}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {[
                  { id: 'all', name: 'All' },
                  ...store.catalog.categories
                    .filter((c) => !c.archived)
                    .sort((a, b) => a.sortOrder - b.sortOrder),
                ].map((c) => (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: c.id === category }}
                    onPress={() =>
                      router.replace({ pathname: '/menu', params: { category: c.id } })
                    }
                    style={[
                      s.chip,
                      { flexDirection: 'row', alignItems: 'center', gap: 8 },
                      c.id === category && s.chipActive,
                    ]}
                  >
                    <FoodCategoryIcon
                      category={c}
                      size={22}
                      color={c.id === category ? 'white' : color.ink}
                    />
                    <Text
                      style={{ fontWeight: '600', color: c.id === category ? 'white' : color.ink }}
                    >
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {!!store.error && (
                <Text accessibilityRole="alert" style={s.error}>
                  {store.error}
                </Text>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={s.sectionTitle}>No dishes found.</Text>
              <Text style={s.body}>Try another search or category.</Text>
            </View>
          }
        />
      )}
    </Page>
  );
}
