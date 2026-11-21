import Svg, { Path } from 'react-native-svg';
import { foodIconKind, foodIconPaths } from '../../../lib/food-icons';
export function FoodCategoryIcon({
  category,
  size = 24,
  color = '#25271f',
}: {
  category?: { id?: string; name?: string; slug?: string };
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {foodIconPaths[foodIconKind(category)].map((d, i) => (
        <Path key={i} d={d} />
      ))}
    </Svg>
  );
}
