export type AddressType = "Shipping" | "Billing";

export interface Address {
  id: string;
  full_name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
  address_type: AddressType;
  is_default: boolean;
}

export interface AddressResponse<T = Address[]> {
  message?: string;
  data: T;
}
export interface CreateAddressData {
  full_name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phone: string;
  address_type: "Shipping" | "Billing";
  is_default: boolean;
}