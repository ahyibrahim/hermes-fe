export interface UserPayload {
  id?: number;
  username: string;
}

export interface AuthResponse {
  username: string;
  token: string;
}

export interface RegisterResponse {
  user: UserPayload;
}

export interface MessageRecord {
  id: number;
  room: string;
  sender: string;
  content: string;
  created_at: string;
}

export interface HealthResponse {
  status: string;
  service: string;
  message: string;
}

export interface RoomRecord {
  id: number;
  slug: string;
  name: string;
  type?: string;
  created_at?: string;
  members?: string[];
}

export interface ClientState {
  username: string | null;
  token: string | null;
  room: string | null;
  roomUsers: string[];
  messages: MessageRecord[];
  baseUrl: string;
}
