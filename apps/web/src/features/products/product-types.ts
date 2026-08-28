export interface UserProduct {
  id: string;
  name: string;
  brand: string | null;
  servingSizeText: string;
  servingMassG: number | null;
  servingVolumeMl: number | null;
  calories: number;
  proteinGrams: number;
  carbohydratesGrams: number;
  status: 'confirmed' | 'estimated';
  labelImagePath: string | null;
  createdAt: string;
}

export interface UserProductDbRow {
  id: string;
  user_id: string;
  name: string;
  brand: string | null;
  serving_size_text: string;
  serving_mass_g: number | null;
  serving_volume_ml: number | null;
  calories: number;
  protein_grams: number;
  carbohydrates_grams: number;
  status: 'confirmed' | 'estimated';
  label_image_path: string | null;
  created_at: string;
}

export interface UserProductInput {
  name: string;
  brand: string | null;
  servingSizeText: string;
  servingMassG: number | null;
  servingVolumeMl: number | null;
  calories: number;
  proteinGrams: number;
  carbohydratesGrams: number;
  status: 'confirmed' | 'estimated';
}
