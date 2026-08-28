create index recipe_ingredients_nutrition_food_id_idx
  on public.recipe_ingredients (nutrition_food_id);

create index recipe_ingredients_user_product_id_idx
  on public.recipe_ingredients (user_product_id);
