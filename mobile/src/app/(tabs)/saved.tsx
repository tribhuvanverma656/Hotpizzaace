import { FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomer } from '../../lib/provider';
import { Button, FoodCard, Icon, Loading, Page, color, s } from '../../components/ui';
export default function Saved() {
  const store = useCustomer();
  return (
    <Page>
      {!store.catalog ? (
        <Loading />
      ) : (
        <FlatList
          contentContainerStyle={[s.content, { flexGrow: 1 }]}
          data={store.catalog.products.filter(
            (p) => !p.archived && store.favourites.includes(p.id),
          )}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => <FoodCard product={item} />}
          ListHeaderComponent={
            <View style={{ marginBottom: 20 }}>
              <Text style={s.title}>Saved favourites</Text>
              <Text style={s.body}>Your favourites, saved on this phone.</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Icon name="heart-outline" size={52} tint={color.red} />
              <Text style={s.sectionTitle}>Your saved dishes appear here.</Text>
              <Text style={[s.body, { textAlign: 'center' }]}>
                Tap the heart on a dish to find it here next time.
              </Text>
              <Button label="Find a favourite" onPress={() => router.push('/menu')} />
            </View>
          }
        />
      )}
    </Page>
  );
}
