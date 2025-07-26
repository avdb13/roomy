import { co, z } from 'jazz-tools';

export const MatrixBridgeRequest = co.map({
  matrixRoomId: z.string(),
  roomyChannelId: z.string(),
  status: z.enum(['requested', 'active', 'inactive', 'error']),

  error: z.string().optional(),
});

export const MatrixBridgeRequestList = co.list(MatrixBridgeRequest);

export const WorkerProfile = co.profile({
  name: z.string(),
  imageUrl: z.string().optional(),
  description: z.string().optional(),

  requests: MatrixBridgeRequestList,
});

export const WorkerAccount = co.account({
  profile: WorkerProfile,
  root: co.map({}),
});