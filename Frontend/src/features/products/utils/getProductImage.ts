import { SUPABASE_URL } from "../../../config/config";

export const getProductImage = (
  productId: string | number,
  imageNumber: number = 1,
) =>
  `${SUPABASE_URL}/storage/v1/object/public/product-images/${productId}/${imageNumber}.webp`;
