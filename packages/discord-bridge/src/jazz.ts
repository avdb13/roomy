import { startWorker as startJazzWorker } from "jazz-tools/worker";
import { Account, AccountSchema, co, Group, z } from "jazz-tools";
import {
  createMessage,
  Message,
  RoomyAccount,
  RoomyProfile,
  ThreadContent,
  Timeline,
} from "@roomy-chat/sdk";

export const DiscordBridgeRequest = co.map({
  discordGuildId: z.string(),
  roomySpaceId: z.string(),
  status: z.enum(["requested", "active", "inactive", "error"]),

  error: z.string().optional(),
});

export const DiscordBridgeRequestList = co.list(DiscordBridgeRequest);

export const WorkerProfile = co.profile({
  name: z.string(),
  imageUrl: z.string().optional(),
  description: z.string().optional(),

  requests: DiscordBridgeRequestList,
});

export const WorkerAccountSchema = co.account({
  profile: WorkerProfile,
  root: co.map({}),
});

export async function startWorker(): Promise<{
  worker: Account & co.loaded<AccountSchema>;
}> {
  const accountID = process.env.JAZZ_WORKER_ACCOUNT;
  const accountSecret = process.env.JAZZ_WORKER_SECRET;
  const jazzEmail = process.env.JAZZ_EMAIL;
  if (!accountID || !accountSecret || !jazzEmail)
    throw new Error(
      "Missing JAZZ_WORKER_ACCOUNT, JAZZ_EMAIL, or JAZZ_WORKER_SECRET env vars",
    );
  const syncServer = `wss://cloud.jazz.tools/?key=${jazzEmail}`;

  const { worker } = await startJazzWorker({
    AccountSchema: WorkerAccountSchema,
    accountID,
    accountSecret,
    syncServer,
  });

  // // load profile as WorkerProfile
  // const profile = await WorkerProfile.load(worker.profile.id, {
  //   loadAs: worker,
  //   resolve: {
  //     requests: {
  //       $each: true,
  //       $onError: null,
  //     },
  //   },
  // });

  // if (!profile?.requests) {
  //   if (!profile) throw new Error("Profile does not exist.");

  //   // create requests lists
  //   console.log("Creating requests lists...");
  //   profile.requests = createRequestsList(worker);
  // } else {
  //   console.log("Requests lists already exist");
  // }

  console.log("Jazz worker initialized successfully with account:", accountID);

  return { worker };
}

export function createRequestsList(worker: Account) {
  let group = Group.create({ owner: worker });
  group.addMember("everyone", "writeOnly");

  return DiscordBridgeRequestList.create([], group);
}

export type RoomyMessage = {
  spaceId: string;
  channelName: string;

  message: string;
  author: string;
  avatarUrl: string;
  timestamp: number;

  messageId: string;
};

// export async function loadThreadsAndStartListening(
//   worker: Account,
//   spaceId: string,
//   onRoomyMessage: (message: RoomyMessage) => void,
// ) {
//   const space = await Space.load(spaceId, {
//     loadAs: worker,
//     resolve: {
//       threads: {
//         $each: {
//           components: {
//             $each: true,
//           },
//         },
//         $onError: null,
//       },
//     },
//   });

//   const adminGroup = await Group.load(space.adminGroupId, {
//     loadAs: worker,
//     resolve: {
//       $onError: null,
//     },
//   });

//   if (!adminGroup) {
//     console.log("No admin group found for space:", spaceId);
//     return [];
//   }

//   const threads = Object.values(space.threads?.perAccount ?? {})
//     .map((accountFeed) => new Array(...accountFeed.all))
//     .flat()
//     .map((a) => a.value);

//   let loadedThreads = [];
//   // load timeline
//   for (const thread of threads) {
//     const content = await ThreadContent.load(thread.components.thread, {
//       loadAs: worker,
//       resolve: {
//         timeline: {
//           $each: true,
//           $onError: null,
//         },
//       },
//     });

//     content.timeline.subscribe(async (timeline) => {
//       const ids = Object.values(timeline.perAccount ?? {})
//         .map((accountFeed) => new Array(...accountFeed.all))
//         .flat()
//         .sort((a, b) => b.madeAt.getTime() - a.madeAt.getTime());

//       for (const id of ids) {
//         const message = await Message.load(id.value);

//         if (!message) {
//           continue;
//         }
//         if (Date.now() - message.createdAt.getTime() > 10000) {
//           console.log(
//             "Message is more than 10 seconds old, skipping",
//             message.createdAt,
//           );
//           continue;
//         }
//         if (message.author?.startsWith("discord:")) {
//           console.log("Message is from discord, skipping", message.author);
//           continue;
//         }

//         const authorId = id.by.profile?.id;
//         if (!authorId) {
//           console.log("No author id found", message);
//           continue;
//         }

//         const author = await RoomyAccount.load(id.by.id, {
//           loadAs: worker,
//           resolve: {
//             profile: true,
//           },
//         });
//         if (!author) {
//           console.log("Failed to load author", authorId);
//           continue;
//         }

//         const name = author.profile?.name;
//         const avatarUrl = author.profile?.imageUrl;

//         onRoomyMessage({
//           spaceId,
//           channelName: thread.name,
//           message: message.content,
//           author: name,
//           avatarUrl,
//           timestamp: message.createdAt.getTime(),
//           messageId: id.value,
//         });
//       }
//     });

//     loadedThreads.push({ thread, content, adminGroup });
//   }

//   return loadedThreads;
// }

// export async function sendMessage(
//   timeline: co.loaded<typeof Timeline>,
//   messageInput: string,
//   author: string,
//   avatarUrl: string,
//   admin: Group,
// ) {
//   const message = createMessage(messageInput, undefined, admin);

//   message.author = `discord:${author}:${encodeURIComponent(avatarUrl)}`;

//   if (timeline) {
//     timeline.push(message.id);
//   }
// }
