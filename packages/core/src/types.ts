export type UserRole = 'member' | 'admin';

export interface UserPayload {
  id?: number;
  username: string;
  role?: UserRole;
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
  file_id?: number | string | null;
}

export interface FileRecord {
  id: number | string;
  room?: string;
  name?: string;
  filename?: string;
  size?: number;
}

export interface FileUploadResponse {
  file: FileRecord;
  message: MessageRecord;
}

export interface HealthResponse {
  status: string;
  service: string;
  message: string;
}

export interface PublicUser {
  id: number;
  username: string;
  role?: UserRole;
  avatar_file_id?: number | null;
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

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfig {
  iceServers: IceServer[];
}

export interface SessionDescriptionPayload {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}
