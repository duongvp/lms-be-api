export interface StaffInfoInput {
  username: string;
  student_hmid?: string;
  email?: string;
  phone?: string;
  name?: string;
  code?: string;
  learn_number?: number;
  islearn?: number;
  room_id?: number;
  class_id?: string;
}


export interface SaveRoomConfigInput {
  code: string;
  learn_number: number;
  config: any;
  updated_by?: string;
  teacher?: StaffInfoInput;
  assistant_teacher?: StaffInfoInput;
}

export interface RoomConfigFilter {
  search?: string;
  code?: string;
  learn_number?: number;
  page?: number;
  limit?: number;
}
