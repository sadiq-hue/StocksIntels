import { io, Socket } from "socket.io-client";

const isVercel = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && !window.location.hostname.includes('127.0.0.1');
const transports = isVercel ? ["polling"] : ["websocket", "polling"];

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      autoConnect: false,
      transports,
    });
  }
  return socket;
}

export function connectSocket(userId: number | string, userName: string): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
    s.on("connect", () => {
      s.emit("identify_user", userId);
    });
  }
  return s;
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}

export function joinGroup(groupId: string): void {
  getSocket().emit("join_group", groupId);
}

export function leaveGroup(groupId: string): void {
  getSocket().emit("leave_group", groupId);
}

export function joinPrivate(userId: number | string, peerId: number | string): void {
  getSocket().emit("join_private", userId, peerId);
}

export function sendMessage(data: {
  senderId?: number | string;
  senderName: string;
  content: string;
  groupId?: string;
  recipientId?: number | string;
  messageType?: string;
  imageUrl?: string;
  fileName?: string;
}): void {
  getSocket().emit("send_message", data);
}

export function emitTyping(data: {
  userId: number | string;
  userName: string;
  groupId?: string;
  recipientId?: number | string;
}): void {
  getSocket().emit("typing", data);
}

export function emitStopTyping(data: {
  userId: number | string;
  groupId?: string;
  recipientId?: number | string;
}): void {
  getSocket().emit("stop_typing", data);
}
