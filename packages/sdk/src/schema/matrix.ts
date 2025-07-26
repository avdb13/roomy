import { co, z } from "jazz-tools";

export const MatrixBridgeRequest = co.map({
  matrixRoomAliasOrId: z.string(),
  roomySpaceId: z.string(),
  status: z.enum(["requested", "active", "inactive", "error"]),

  error: z.string().optional(),
});

export const MatrixBridgeRequestList = co.list(MatrixBridgeRequest);

export const MatrixWorkerProfile = co.profile({
  name: z.string(),
  imageUrl: z.string().optional(),
  description: z.string().optional(),

  requests: MatrixBridgeRequestList,
});

export const MatrixWorkerAccount = co.account({
  profile: MatrixWorkerProfile,
  root: co.map({}),
});