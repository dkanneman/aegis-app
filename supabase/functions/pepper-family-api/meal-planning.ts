export type MealNeed = { label?: string | null; details?: string | null };

export type MealRecipe = {
  name: string;
  flags: string[];
  groceries: string[];
};

export const MEAL_LIBRARY: MealRecipe[] = [
  { name: "Chicken rice bowls", flags: ["meat"], groceries: ["Chicken", "Rice", "Bell peppers", "Cucumber", "Avocado"] },
  { name: "Build-your-own taco bowls", flags: ["meat"], groceries: ["Ground turkey", "Black beans", "Rice", "Lettuce", "Tomatoes", "Avocado"] },
  { name: "Sheet-pan chicken and vegetables", flags: ["meat"], groceries: ["Chicken", "Potatoes", "Broccoli", "Carrots"] },
  { name: "Salmon, rice, and green beans", flags: ["fish"], groceries: ["Salmon", "Rice", "Green beans", "Lemons"] },
  { name: "Vegetable stir-fry with rice", flags: ["soy"], groceries: ["Rice", "Broccoli", "Bell peppers", "Snap peas", "Stir-fry sauce"] },
  { name: "Pasta marinara and salad", flags: ["gluten"], groceries: ["Pasta", "Marinara sauce", "Salad greens", "Tomatoes"] },
  { name: "Turkey burgers and salad", flags: ["meat", "gluten"], groceries: ["Turkey burger patties", "Burger buns", "Salad greens", "Tomatoes"] },
  { name: "Black bean taco bowls", flags: [], groceries: ["Black beans", "Rice", "Corn", "Lettuce", "Tomatoes", "Avocado"] },
  { name: "Baked potato bar", flags: [], groceries: ["Potatoes", "Broccoli", "Green onions", "Black beans"] },
  { name: "Vegetable soup and salad", flags: [], groceries: ["Vegetable broth", "Carrots", "Celery", "Potatoes", "Salad greens"] },
];

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function allowedMeals(needs: MealNeed[]) {
  const text = needs
    .map((need) => `${need.label || ""} ${need.details || ""}`)
    .join(" ")
    .toLowerCase();
  const blocked = new Set<string>();
  if (/vegetarian|vegan|no meat/.test(text)) blocked.add("meat");
  if (/fish allergy|no fish|avoid fish|seafood allergy/.test(text)) blocked.add("fish");
  if (/gluten[ -]?free|celiac|no gluten/.test(text)) blocked.add("gluten");
  if (/soy allergy|no soy/.test(text)) blocked.add("soy");
  const allowed = MEAL_LIBRARY.filter((meal) =>
    meal.flags.every((flag) => !blocked.has(flag)),
  );
  return allowed.length ? allowed : MEAL_LIBRARY.filter((meal) => meal.flags.length === 0);
}

export function wantsMealPlanRefresh(value: string) {
  const text = normalized(value);
  const namesFood = /\b(meal|meals|dinner|menu|food|grocery|groceries|shopping|fish|salmon|chicken|pasta|taco|burger|soup|stir[ -]?fry)\b/.test(text);
  const requestsChange = /\b(refresh|regenerate|replan|redo|replace|change|repeat(?:ed|ing)?|twice|again|last night|yesterday)\b/.test(text);
  return namesFood && requestsChange;
}

function recentlyEatenFlags(value: string) {
  const text = normalized(value);
  const recent = /\b(last night|yesterday|recently|again|repeat(?:ed|ing)?|twice)\b/.test(text);
  if (!recent) return new Set<string>();
  const flags = new Set<string>();
  if (/\b(fish|salmon|seafood)\b/.test(text)) flags.add("fish");
  if (/\b(chicken|turkey|burger|meat)\b/.test(text)) flags.add("meat");
  if (/\b(pasta|noodle)\b/.test(text)) flags.add("gluten");
  if (/\b(stir[ -]?fry|soy)\b/.test(text)) flags.add("soy");
  return flags;
}

export function chooseMealWeek(
  needs: MealNeed[],
  currentMealNames: string[],
  instruction = "",
  count = 7,
) {
  const allowed = allowedMeals(needs);
  const avoidedFlags = recentlyEatenFlags(instruction);
  const filtered = allowed.filter((meal) =>
    meal.flags.every((flag) => !avoidedFlags.has(flag)),
  );
  const choices = filtered.length ? filtered : allowed;
  const currentFirst = normalized(currentMealNames[0] || "");
  const currentIndex = choices.findIndex(
    (meal) => normalized(meal.name) === currentFirst,
  );
  const offset = currentIndex >= 0 && choices.length > 1 ? currentIndex + 1 : 0;
  return Array.from(
    { length: count },
    (_, index) => choices[(offset + index) % choices.length],
  );
}

export function uniqueGroceriesForWeek(recipes: MealRecipe[]) {
  const groceries = new Map<string, { item: string; mealIndex: number }>();
  recipes.forEach((recipe, mealIndex) => {
    recipe.groceries.forEach((item) => {
      const key = normalized(item);
      if (!groceries.has(key)) groceries.set(key, { item, mealIndex });
    });
  });
  return [...groceries.entries()].map(([normalizedItem, value]) => ({
    normalizedItem,
    ...value,
  }));
}
