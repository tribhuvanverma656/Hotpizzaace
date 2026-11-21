import { ImageBackground, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useCustomer } from '../../lib/provider';
import { Button, FoodCard, Icon, Loading, Page, color, s } from '../../components/ui';
import { FoodCategoryIcon } from '../../components/food-category-icon';
export default function Home() {
  const store = useCustomer();
  const products = store.catalog?.products.filter((p) => !p.archived && p.available) || [];
  const featured = products.filter((p) => p.bestseller || p.featured).slice(0, 4);
  return (
    <Page>
      {!store.catalog ? (
        <Loading />
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={store.loading}
              onRefresh={() => void store.refresh()}
              tintColor={color.red}
            />
          }
          contentContainerStyle={s.content}
        >
          <View style={{ gap: 8 }}>
            <Text style={[s.eyebrow, { color: color.red }]}>HOT PIZZA ACE</Text>
            <Text style={[s.title, { fontSize: 36 }]}>Your favourites,{'\n'}freshly prepared.</Text>
            <Text style={s.body}>Pizza, sides and drinks. Order for delivery or pickup.</Text>
          </View>
          <ImageBackground
            source={require('../../../assets/hero-pizza.jpg')}
            imageStyle={{ borderRadius: 22 }}
            style={{
              height: 270,
              justifyContent: 'flex-end',
              padding: 22,
              borderRadius: 22,
              overflow: 'hidden',
              backgroundColor: color.ink,
            }}
          >
            <View
              style={{
                backgroundColor: 'rgba(25,26,20,.72)',
                padding: 16,
                borderRadius: 16,
                gap: 10,
              }}
            >
              <Text style={{ fontSize: 25, fontWeight: '800', color: 'white' }}>
                Choose your pizza.{'\n'}Make it your own.
              </Text>
              <Button label="Explore the menu  →" onPress={() => router.push('/menu')} />
            </View>
          </ImageBackground>
          <View style={[s.row, { justifyContent: 'space-between', paddingVertical: 10 }]}>
            <View style={s.row}>
              <Icon name="time-outline" tint={color.green} />
              <Text style={s.small}>Made fresh</Text>
            </View>
            <View style={s.row}>
              <Icon name="shield-checkmark-outline" tint={color.green} />
              <Text style={s.small}>Secure checkout</Text>
            </View>
          </View>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={s.sectionTitle}>Browse categories</Text>
            <Pressable accessibilityRole="button" onPress={() => router.push('/menu')}>
              <Text style={s.link}>View all →</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {store.catalog?.categories
              .filter((c) => !c.archived)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/menu', params: { category: c.id } })}
                  style={[s.chip, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
                >
                  <FoodCategoryIcon category={c} size={22} />
                  <Text style={{ fontWeight: '600', color: color.ink }}>{c.name}</Text>
                </Pressable>
              ))}
          </ScrollView>
          <Text style={s.sectionTitle}>Featured dishes</Text>
          {(featured.length ? featured : products.slice(0, 4)).map((p) => (
            <FoodCard key={p.id} product={p} />
          ))}
          <View style={s.notice}>
            <Text style={[s.cardTitle, { color: color.green }]}>Delivery or pickup</Text>
            <Text style={s.body}>
              Choose delivery or pickup during checkout. Your restaurant confirms every order.
            </Text>
          </View>
          {!!store.error && (
            <Text accessibilityRole="alert" style={s.error}>
              {store.error}
            </Text>
          )}
        </ScrollView>
      )}
    </Page>
  );
}
