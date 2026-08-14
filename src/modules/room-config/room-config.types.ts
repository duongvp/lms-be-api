export interface SaveRoomConfigInput {
  code: string;
  learn_number: number;
  config: any;
  updated_by?: string;
}

export interface RoomConfigFilter {
  search?: string;
  code?: string;
  learn_number?: number;
  page?: number;
  limit?: number;
}
