import { SUPABASE_URL } from "../../../config/config";

/** Original image location for products created before the image gallery (product-images/<id>/<n>.webp). */
export const getProductImage = (
  productId: string | number,
  imageNumber: number = 1,
) =>
  `${SUPABASE_URL}/storage/v1/object/public/product-images/${productId}/${imageNumber}.webp`;

/** Main image of a product: its gallery image when it has one, otherwise the original image location. */
export const productImage = (p: { id: string | number; image?: string | null } | null | undefined) =>
  p ? p.image || getProductImage(p.id) : "";
