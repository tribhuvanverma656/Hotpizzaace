import { foodIconKind, foodIconPaths } from '@/lib/food-icons';
export function FoodCategoryIcon({
  category,
  size = 24,
}: {
  category?: { id?: string; name?: string; slug?: string };
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {foodIconPaths[foodIconKind(category)].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
