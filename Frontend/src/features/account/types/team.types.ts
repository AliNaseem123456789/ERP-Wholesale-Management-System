export interface SubAccount {
  id: string;
  permissions: {
    can_place_order: boolean;
  };
  users: {
    first_name: string;
    last_name: string;
    email: string;
    created_at: string;
  };
}

export interface TeamResponse {
  success: boolean;
  data: SubAccount[];
}
