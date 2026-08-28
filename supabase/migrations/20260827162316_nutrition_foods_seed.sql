-- Small, transparent starter catalog for the deterministic calculator.
-- Values are estimates and are always labelled as such in the UI.
insert into public.nutrition_foods
  (name, normalized_name, basis, preparation, calories, protein_grams, carbohydrates_grams, source, status)
values
  ('Chicken breast', 'chicken breast', '100g', 'raw', 120, 22.5, 0, 'opendish_seed_20260827', 'estimated'),
  ('Ground beef 90/10', 'ground beef 90/10', '100g', 'raw', 176, 20, 0, 'opendish_seed_20260827', 'estimated'),
  ('Onion', 'onion', '100g', 'raw', 40, 1.1, 9.3, 'opendish_seed_20260827', 'estimated'),
  ('White rice', 'white rice', '100g', 'cooked', 130, 2.7, 28.2, 'opendish_seed_20260827', 'estimated'),
  ('Egg', 'egg', '100g', 'raw', 143, 12.6, 0.7, 'opendish_seed_20260827', 'estimated'),
  ('Olive oil', 'olive oil', '100g', 'not_applicable', 884, 0, 0, 'opendish_seed_20260827', 'estimated')
on conflict (normalized_name, basis, preparation, source) do update set
  calories = excluded.calories,
  protein_grams = excluded.protein_grams,
  carbohydrates_grams = excluded.carbohydrates_grams,
  status = excluded.status,
  updated_at = now();
